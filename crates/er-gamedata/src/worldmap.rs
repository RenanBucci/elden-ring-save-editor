//! World map image from `/menu/71_maptile.tpfbhd|tpfbdt`, a split binder of 256x256 BC7 tiles
//! named `MENU_MapTile_M{map}_L{zoom}_{x}_{y}_{mask}`. The mask lists the map fragments that
//! reveal that tile; the variant with the most bits set is the fully revealed one.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::archive::ArchiveError;
use crate::catalog::Index;
use crate::decompress_dcx;

pub const TILE: usize = 256;

#[derive(Debug, Clone)]
struct Tile {
    x: usize,
    y: usize,
    mask: u32,
    offset: u64,
    size: usize,
}

fn err(message: impl Into<String>) -> ArchiveError {
    ArchiveError::Message(message.into())
}

fn utf16_at(buf: &[u8], offset: usize) -> String {
    let mut text = String::new();
    let mut cursor = offset;
    while cursor + 1 < buf.len() {
        let code = u16::from_le_bytes([buf[cursor], buf[cursor + 1]]);
        if code == 0 {
            break;
        }
        text.push(char::from_u32(u32::from(code)).unwrap_or('?'));
        cursor += 2;
    }
    text
}

/// Every variant of one tile, as (mask, RGBA-as-u32 pixels). For probing.
pub fn tile_variants(index: &Index, map: &str, level: &str, x: usize, y: usize) -> Result<Vec<(u32, Vec<u32>)>, ArchiveError> {
    let bhd = index.read("/menu/71_maptile.tpfbhd")?;
    let (bdt_path, bdt) = index.entry("/menu/71_maptile.tpfbdt").ok_or_else(|| err("dados do mapa ausentes"))?;
    let prefix = format!("MENU_MapTile_{map}_{level}_{x:02}_{y:02}_");
    let count = u32::from_le_bytes(bhd[0x0C..0x10].try_into().unwrap()) as usize;
    let entry_size = u64::from_le_bytes(bhd[0x20..0x28].try_into().unwrap()) as usize;
    let mut file = std::fs::File::open(&bdt_path).map_err(|error| err(error.to_string()))?;
    let mut out = Vec::new();
    for entry in 0..count {
        let at = 0x40 + entry * entry_size;
        let name = utf16_at(&bhd, u32::from_le_bytes(bhd[at + 0x20..at + 0x24].try_into().unwrap()) as usize);
        let stem = name.rsplit('\\').next().unwrap_or(&name).trim_end_matches(".tpf.dcx");
        let Some(mask) = stem.strip_prefix(&prefix) else { continue };
        let size = u64::from_le_bytes(bhd[at + 8..at + 16].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(bhd[at + 0x18..at + 0x1C].try_into().unwrap()) as u64;
        file.seek(SeekFrom::Start(bdt.offset as u64 + offset)).map_err(|error| err(error.to_string()))?;
        let mut raw = vec![0u8; size];
        file.read_exact(&mut raw).map_err(|error| err(error.to_string()))?;
        let tpf = decompress_dcx(&raw, index.oodle.as_deref())?;
        let (_, _, pixels) = dds_pixels(tpf_first_texture(&tpf)?)?;
        out.push((u32::from_str_radix(mask, 16).unwrap_or(0), pixels));
    }
    Ok(out)
}

fn tiles(bhd: &[u8], map: &str, level: &str) -> Result<Vec<Tile>, ArchiveError> {
    if !bhd.starts_with(b"BHF4") {
        return Err(err("cabeçalho do mapa não é BHF4"));
    }
    let count = u32::from_le_bytes(bhd[0x0C..0x10].try_into().unwrap()) as usize;
    let entry_size = u64::from_le_bytes(bhd[0x20..0x28].try_into().unwrap()) as usize;
    let prefix = format!("MENU_MapTile_{map}_{level}_");
    let mut best: HashMap<(usize, usize), Tile> = HashMap::new();
    for index in 0..count {
        let at = 0x40 + index * entry_size;
        if at + 0x24 > bhd.len() {
            break;
        }
        let name = utf16_at(bhd, u32::from_le_bytes(bhd[at + 0x20..at + 0x24].try_into().unwrap()) as usize);
        let stem = name.rsplit('\\').next().unwrap_or(&name).trim_end_matches(".tpf.dcx");
        let Some(rest) = stem.strip_prefix(&prefix) else { continue };
        let parts: Vec<&str> = rest.split('_').collect();
        if parts.len() != 3 {
            continue;
        }
        let (Ok(x), Ok(y), Ok(mask)) = (parts[0].parse(), parts[1].parse(), u32::from_str_radix(parts[2], 16)) else { continue };
        let tile = Tile {
            x,
            y,
            mask,
            size: u64::from_le_bytes(bhd[at + 8..at + 16].try_into().unwrap()) as usize,
            offset: u32::from_le_bytes(bhd[at + 0x18..at + 0x1C].try_into().unwrap()) as u64,
        };
        let rank = |mask: u32| (mask.count_ones(), mask);
        let better = best.get(&(x, y)).map_or(true, |current| rank(tile.mask) > rank(current.mask));
        if better {
            best.insert((x, y), tile);
        }
    }
    Ok(best.into_values().collect())
}

fn dds_pixels(dds: &[u8]) -> Result<(usize, usize, Vec<u32>), ArchiveError> {
    if !dds.starts_with(b"DDS ") || dds.len() < 0x80 {
        return Err(err("textura sem cabeçalho DDS"));
    }
    let height = u32::from_le_bytes(dds[0x0C..0x10].try_into().unwrap()) as usize;
    let width = u32::from_le_bytes(dds[0x10..0x14].try_into().unwrap()) as usize;
    let four_cc = &dds[0x54..0x58];
    let (format, start) = if four_cc == b"DX10" {
        (u32::from_le_bytes(dds[0x80..0x84].try_into().unwrap()), 0x94)
    } else {
        let code = match four_cc {
            b"DXT1" => 71,
            b"DXT5" => 77,
            b"ATI2" | b"BC5U" => 83,
            _ => 0,
        };
        (code, 0x80)
    };
    let data = &dds[start..];
    let mut image = vec![0u32; width * height];
    let result = match format {
        98 | 99 => texture2ddecoder::decode_bc7(data, width, height, &mut image),
        71 | 72 => texture2ddecoder::decode_bc1(data, width, height, &mut image),
        77 | 78 => texture2ddecoder::decode_bc3(data, width, height, &mut image),
        83 => texture2ddecoder::decode_bc5(data, width, height, &mut image),
        other => return Err(err(format!("formato de textura {other} não suportado"))),
    };
    result.map_err(err)?;
    Ok((width, height, image))
}

fn tpf_first_texture(tpf: &[u8]) -> Result<&[u8], ArchiveError> {
    if !tpf.starts_with(b"TPF\0") || tpf.len() < 0x20 {
        return Err(err("peça do mapa não é TPF"));
    }
    let offset = u32::from_le_bytes(tpf[0x10..0x14].try_into().unwrap()) as usize;
    let size = u32::from_le_bytes(tpf[0x14..0x18].try_into().unwrap()) as usize;
    tpf.get(offset..offset + size).ok_or_else(|| err("textura fora do TPF"))
}

pub struct MapImage {
    pub width: usize,
    pub height: usize,
    /// RGB, row-major.
    pub rgb: Vec<u8>,
}

pub fn compose(index: &Index, map: &str, level: &str) -> Result<MapImage, ArchiveError> {
    compose_with(index, map, level, |tile: (usize, usize)| tile)
}

pub fn compose_with(index: &Index, map: &str, level: &str, place: impl Fn((usize, usize)) -> (usize, usize)) -> Result<MapImage, ArchiveError> {
    let bhd = index.read("/menu/71_maptile.tpfbhd")?;
    let (bdt_path, bdt) = index.entry("/menu/71_maptile.tpfbdt").ok_or_else(|| err("dados do mapa ausentes"))?;
    if !bdt.aes_ranges.is_empty() {
        return Err(err("dados do mapa criptografados"));
    }
    let mut list = tiles(&bhd, map, level)?;
    if list.is_empty() {
        return Err(err(format!("mapa {map} {level} não encontrado")));
    }
    for tile in &mut list {
        (tile.x, tile.y) = place((tile.x, tile.y));
    }
    let columns = list.iter().map(|tile| tile.x).max().unwrap() + 1;
    let rows = list.iter().map(|tile| tile.y).max().unwrap() + 1;
    let width = columns * TILE;
    let height = rows * TILE;
    let mut rgb = vec![0u8; width * height * 3];
    let mut file = std::fs::File::open(&bdt_path).map_err(|error| err(error.to_string()))?;
    for tile in list {
        file.seek(SeekFrom::Start(bdt.offset as u64 + tile.offset)).map_err(|error| err(error.to_string()))?;
        let mut raw = vec![0u8; tile.size];
        file.read_exact(&mut raw).map_err(|error| err(error.to_string()))?;
        let tpf = decompress_dcx(&raw, index.oodle.as_deref())?;
        let (w, h, pixels) = dds_pixels(tpf_first_texture(&tpf)?)?;
        let row_top = rows - 1 - tile.y;
        for py in 0..h.min(TILE) {
            for px in 0..w.min(TILE) {
                let [b, g, r, _] = pixels[py * w + px].to_le_bytes();
                let at = ((row_top * TILE + py) * width + tile.x * TILE + px) * 3;
                rgb[at] = r;
                rgb[at + 1] = g;
                rgb[at + 2] = b;
            }
        }
    }
    Ok(MapImage { width, height, rgb })
}

pub fn save_jpeg(image: &MapImage, path: &Path, quality: u8) -> Result<(), ArchiveError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| err(error.to_string()))?;
    }
    let encoder = jpeg_encoder::Encoder::new_file(path, quality).map_err(|error| err(error.to_string()))?;
    encoder
        .encode(&image.rgb, image.width as u16, image.height as u16, jpeg_encoder::ColorType::Rgb)
        .map_err(|error| err(error.to_string()))
}

/// One menu map and the linear fit from world meters to its composed image.
/// The fit was calibrated by overlaying every grace of the area on the image.
/// The menu map is drawn flatter north-south than the world, so each axis has its own scale.
#[derive(Debug, Clone, Copy)]
pub struct MapSpec {
    pub id: &'static str,
    pub level: &'static str,
    pub area: u8,
    pub scale_x: f64,
    pub scale_z: f64,
    pub origin_x: f64,
    pub origin_z: f64,
}

/// L1 and L2 of the base map do not follow a plain grid, so the base map uses L3.
pub const MAPS: [MapSpec; 2] = [
    MapSpec { id: "M00", level: "L3", area: 60, scale_x: 0.14634, scale_z: 0.1238, origin_x: 6714.0, origin_z: 6059.0 },
    MapSpec { id: "M10", level: "L2", area: 61, scale_x: 0.2195, scale_z: 0.2195, origin_x: 7435.0, origin_z: 5342.0 },
];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CachedMap {
    pub id: String,
    pub file: PathBuf,
    pub crop_x: usize,
    pub crop_y: usize,
    pub width: usize,
    pub height: usize,
    pub full_height: usize,
}

fn crop_dark(image: &MapImage) -> (usize, usize, usize, usize) {
    let lit = |x: usize, y: usize| {
        let at = (y * image.width + x) * 3;
        u16::from(image.rgb[at]) + u16::from(image.rgb[at + 1]) + u16::from(image.rgb[at + 2]) > 30
    };
    let (mut x0, mut y0, mut x1, mut y1) = (image.width, image.height, 0, 0);
    for y in (0..image.height).step_by(2) {
        for x in (0..image.width).step_by(2) {
            if lit(x, y) {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
            }
        }
    }
    if x1 <= x0 || y1 <= y0 {
        return (0, 0, image.width, image.height);
    }
    (x0, y0, x1.min(image.width) - x0, y1.min(image.height) - y0)
}

pub fn cached(game: &Path, spec: &MapSpec) -> Result<CachedMap, ArchiveError> {
    let root = crate::cache_root();
    let meta = root.join(format!("worldmap-v2-{}-{}.json", spec.id, spec.level));
    if let Ok(text) = std::fs::read_to_string(&meta) {
        if let Ok(map) = serde_json::from_str::<CachedMap>(&text) {
            if map.file.exists() {
                return Ok(map);
            }
        }
    }
    let index = Index::open(game)?;
    let image = compose(&index, spec.id, spec.level)?;
    let (x0, y0, width, height) = crop_dark(&image);
    let mut rgb = Vec::with_capacity(width * height * 3);
    for y in y0..y0 + height {
        rgb.extend_from_slice(&image.rgb[(y * image.width + x0) * 3..(y * image.width + x0 + width) * 3]);
    }
    let file = root.join(format!("worldmap-v2-{}-{}.jpg", spec.id, spec.level));
    save_jpeg(&MapImage { width, height, rgb }, &file, 95)?;
    let map = CachedMap { id: spec.id.into(), file, crop_x: x0, crop_y: y0, width, height, full_height: image.height };
    std::fs::write(&meta, serde_json::to_string(&map).unwrap_or_default()).map_err(|error| err(error.to_string()))?;
    Ok(map)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GracePoint {
    pub flag: u32,
    pub area: u8,
    pub map: &'static str,
    /// 0..1 across the cropped image.
    pub x: f64,
    pub y: f64,
    /// The grace is in the underground; the point is the spot above it on the surface map.
    pub underground: bool,
}

struct Place {
    area: u8,
    grid_x: u8,
    grid_z: u8,
    x: f64,
    y: f64,
    z: f64,
}

fn f32_at(row: &[u8], at: usize) -> f64 {
    f64::from(f32::from_le_bytes(row[at..at + 4].try_into().unwrap()))
}

fn place_at(row: &[u8], at: usize) -> Place {
    Place { area: row[at], grid_x: row[at + 1], grid_z: row[at + 2], x: f32_at(row, at + 4), y: f32_at(row, at + 8), z: f32_at(row, at + 12) }
}

/// Follows WorldMapLegacyConvParam until the point reaches an open-world area (60 or 61).
fn to_open_world(mut place: Place, links: &[(Place, Place)]) -> Option<Place> {
    for _ in 0..6 {
        if place.area == 60 || place.area == 61 {
            return Some(place);
        }
        let (source, target) = links.iter().find(|(source, _)| {
            source.area == place.area && source.grid_x == place.grid_x && source.grid_z == place.grid_z
        })?;
        place = Place {
            area: target.area,
            grid_x: target.grid_x,
            grid_z: target.grid_z,
            x: target.x + (place.x - source.x),
            y: target.y + (place.y - source.y),
            z: target.z + (place.z - source.z),
        };
    }
    None
}

pub fn grace_points(game: &Path, maps: &[CachedMap]) -> Result<Vec<GracePoint>, ArchiveError> {
    grace_points_with(game, maps, &MAPS)
}

pub fn grace_points_with(game: &Path, maps: &[CachedMap], specs: &[MapSpec]) -> Result<Vec<GracePoint>, ArchiveError> {
    let plain = crate::regulation::open(game)?;
    let bonfires = crate::regulation::param(&plain, "BonfireWarpParam")?;
    let conversions = crate::regulation::param(&plain, "WorldMapLegacyConvParam")?;
    let mut links: Vec<(bool, Place, Place)> = conversions.rows.iter().filter_map(|(id, _)| {
        let row = conversions.row(*id)?;
        (row.len() >= 0x24).then(|| (row[0] == 1, place_at(row, 4), place_at(row, 0x14)))
    }).collect();
    links.sort_by_key(|(base, _, _)| !*base);
    let links: Vec<(Place, Place)> = links.into_iter().map(|(_, source, target)| (source, target)).collect();

    let mut points = Vec::new();
    for (id, _) in &bonfires.rows {
        let Some(row) = bonfires.row(*id) else { continue };
        if row.len() < 0x30 || *id <= 0 {
            continue;
        }
        let flag = u32::from_le_bytes(row[4..8].try_into().unwrap());
        let start = place_at(row, 0x20);
        let area = start.area;
        let underground = area == 12;
        let Some(place) = to_open_world(start, &links) else { continue };
        let Some(spec) = specs.iter().find(|spec| spec.area == place.area) else { continue };
        let Some(map) = maps.iter().find(|map| map.id == spec.id) else { continue };
        let world_x = f64::from(place.grid_x) * 256.0 + place.x;
        let world_z = f64::from(place.grid_z) * 256.0 + place.z;
        let px = (world_x - spec.origin_x) * spec.scale_x - map.crop_x as f64;
        let py = map.full_height as f64 - (world_z - spec.origin_z) * spec.scale_z - map.crop_y as f64;
        points.push(GracePoint { flag, area, map: spec.id, x: px / map.width as f64, y: py / map.height as f64, underground });
    }
    Ok(points)
}
