import { useLocale } from '../i18n/locale';
import { isDlcRegion, locate, pretty, splitName, tileOf } from '../world';

export default function SchematicMap({ graces, flags, focus }) {
    const { tr } = useLocale();
    const target = focus ? locate(focus) : null;
    const dlc = target ? target.dlc : false;
    const points = [];
    const byTile = new Map();
    for (const grace of graces) {
        const tile = tileOf(grace.id);
        if (!tile) continue;
        const { region } = splitName(grace.name);
        if (isDlcRegion(region) !== dlc) continue;
        const key = `${tile.x}_${tile.z}`;
        if (!byTile.has(key)) byTile.set(key, []);
        byTile.get(key).push({ grace, tile, region });
    }
    for (const list of byTile.values()) {
        list.forEach((entry, index) => {
            const angle = (index / list.length) * Math.PI * 2;
            const spread = list.length > 1 ? 0.3 : 0;
            points.push({ ...entry, x: entry.tile.x + 0.5 + Math.cos(angle) * spread, z: entry.tile.z + 0.5 + Math.sin(angle) * spread });
        });
    }
    if (!points.length) return null;
    const xs = points.map((point) => point.x);
    const zs = points.map((point) => point.z);
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const minZ = Math.min(...zs) - 1;
    const maxZ = Math.max(...zs) + 1;
    const cell = 12;
    const width = (maxX - minX) * cell;
    const height = (maxZ - minZ) * cell;
    const span = Math.max(width, height);
    const padX = (span - width) / 2;
    const padY = (span - height) / 2;
    const px = (x) => (x - minX) * cell;
    const pz = (z) => (maxZ - z) * cell;

    const regions = new Map();
    for (const point of points) {
        if (!regions.has(point.region)) regions.set(point.region, []);
        regions.get(point.region).push(point);
    }
    const highlightRegion = target?.kind === 'near' ? target.near : null;
    const focusId = target?.kind === 'exact' ? focus.id : null;
    const found = points.filter((point) => flags[point.grace.flag || point.grace.id]).length;

    return (
        <figure className="grace-map">
            <svg viewBox={`${-padX} ${-padY} ${span} ${span}`} role="img" aria-label={tr("Posição aproximada das graças")}>
                <rect x={-padX} y={-padY} width={span} height={span} rx="10" className="map-bg" />
                {[...regions.entries()].map(([region, list]) => {
                    const cx = list.reduce((sum, point) => sum + px(point.x), 0) / list.length;
                    const cy = list.reduce((sum, point) => sum + pz(point.z), 0) / list.length;
                    return <text key={region} x={cx} y={cy} className={region === highlightRegion || region === target?.region ? 'map-label strong' : 'map-label'}>{pretty(region)}</text>;
                })}
                {points.map((point) => {
                    const on = !!flags[point.grace.flag || point.grace.id];
                    const inRegion = highlightRegion && point.region === highlightRegion;
                    const isFocus = point.grace.id === focusId;
                    return (
                        <circle key={point.grace.id} cx={px(point.x)} cy={pz(point.z)} r={isFocus ? 6 : inRegion ? 3.6 : 2.4}
                            className={isFocus ? 'dot focus' : inRegion ? 'dot near' : on ? 'dot on' : 'dot'} />
                    );
                })}
            </svg>
            <figcaption>
                {dlc ? tr("Terra das Sombras") : tr("Terras Intermédias")} · {found} {tr("de")} {points.length} {tr("graças do mapa aberto descobertas.")} {' '}{tr("Cada ponto fica no quadrante do mapa em que a graça está. A posição é aproximada.")} </figcaption>
        </figure>
    );
}
