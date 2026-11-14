import { useLocale } from '../i18n/locale';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import { pretty, splitName } from '../world';
import SchematicMap from './SchematicMap';

let mapPromise = null;
function loadMap() {
    mapPromise ||= call('worldMap').then(async (res) => {
        if (!res?.ok) {
            mapPromise = null;
            return res;
        }
        const maps = [];
        for (const map of res.maps || []) {
            const image = await call('worldMapImage', map.file);
            if (!image?.ok || !image.image) {
                mapPromise = null;
                return { ok: false, error: image?.error || 'A imagem do mapa não abriu.' };
            }
            maps.push({ ...map, image: image.image });
        }
        return { ...res, maps };
    });
    return mapPromise;
}

const ZOOMS = [1, 2, 3.5, 6];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sheetStyle(map, zoom, x, y) {
    const ratio = map.width / Math.max(1, map.height);
    const baseW = ratio >= 1 ? 1 : ratio;
    const baseH = ratio >= 1 ? 1 / ratio : 1;
    const w = baseW * zoom;
    const h = baseH * zoom;
    const left = w >= 1 ? clamp(0.5 - x * w, 1 - w, 0) : (1 - w) / 2;
    const top = h >= 1 ? clamp(0.5 - y * h, 1 - h, 0) : (1 - h) / 2;
    return {
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        left: `${left * 100}%`,
        top: `${top * 100}%`,
    };
}

export default function GraceMap({ graces, flags, focus, onPick }) {
    const { tr } = useLocale();
    const [data, setData] = useState(null);
    const [failed, setFailed] = useState('');
    const [view, setView] = useState({ key: null, map: 'M00', zoom: 1, x: 0.5, y: 0.5 });
    const [filled, setFilled] = useState(false);

    useEffect(() => {
        let alive = true;
        loadMap().then((res) => {
            if (!alive) return;
            if (res?.ok && res.maps?.length) setData(res);
            else setFailed(res?.error || 'O mapa não respondeu.');
        }).catch((error) => {
            if (alive) setFailed(String(error));
        });
        return () => { alive = false; };
    }, []);

    const byFlag = useMemo(() => new Map((data?.points || []).map((point) => [point.flag, point])), [data]);
    const rows = useMemo(() => graces.map((row) => ({ row, point: byFlag.get(row.flag || row.id) })).filter((entry) => entry.point), [graces, byFlag]);
    const focusKey = focus ? (focus.flag || focus.id) : null;
    const focusPoint = focusKey ? byFlag.get(focusKey) : null;
    if (focusPoint && view.key !== focusKey) {
        setView({ key: focusKey, map: focusPoint.map, zoom: 2, x: focusPoint.x, y: focusPoint.y });
    }
    const { zoom } = view;

    if (failed) return <div><p className="lead">{tr(failed)}</p><SchematicMap graces={graces} flags={flags} focus={focus} /></div>;
    if (!data) return <p className="lead">{tr("Montando o mapa a partir dos arquivos do jogo. Na primeira vez leva alguns segundos.")}</p>;

    const map = data.maps.find((entry) => entry.id === view.map) || data.maps[0];
    const visible = rows.filter((entry) => entry.point.map === map.id);
    const found = visible.filter((entry) => flags[entry.row.flag || entry.row.id]).length;

    function step(direction) {
        const index = Math.max(0, ZOOMS.findIndex((value) => value >= zoom));
        const next = ZOOMS[clamp(index + direction, 0, ZOOMS.length - 1)];
        setView(next === 1 ? { ...view, zoom: 1, x: 0.5, y: 0.5 } : { ...view, zoom: next });
    }

    const figure = (
        <figure className="grace-map real">
            <div className="map-toolbar">
                <div className="segmented">
                    {data.maps.map((entry) => (
                        <button key={entry.id} className={entry.id === map.id ? 'active' : ''}
                            onClick={() => setView({ key: view.key, map: entry.id, zoom: 1, x: 0.5, y: 0.5 })}>{tr(entry.label)}</button>
                    ))}
                </div>
                <span className="spacer" />
                <button onClick={() => step(-1)} disabled={zoom <= ZOOMS[0]} aria-label={tr("Afastar")}>−</button>
                <button onClick={() => step(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label={tr("Aproximar")}>+</button>
                <button onClick={() => setFilled((current) => !current)}>{filled ? tr("Sair da tela cheia") : tr("Tela cheia")}</button>
            </div>
            <div className="map-square">
            <div className="map-frame">
                <div className="map-canvas" style={sheetStyle(map, zoom, view.x, view.y)}
                    onClick={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        const x = (event.clientX - box.left) / box.width;
                        const y = (event.clientY - box.top) / box.height;
                        setView({ ...view, zoom: Math.max(zoom, 2), x, y });
                    }}>
                    <img src={map.image} alt={tr(map.label)} draggable={false}
                        onError={() => setFailed(tr("A imagem do mapa foi gerada, mas a janela não conseguiu abri-la."))} />
                    {visible.map(({ row, point }) => {
                        const id = row.flag || row.id;
                        const isFocus = focus && (focus.flag || focus.id) === id;
                        const className = ['map-dot', flags[id] ? 'on' : '', point.underground ? 'under' : '', isFocus ? 'focus' : ''].join(' ');
                        const { region, place } = splitName(row.name);
                        return (
                            <button key={id} className={className} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                                title={`${pretty(place)} · ${pretty(region)}${point.underground ? tr(" (subterrâneo)") : ''}`}
                                onClick={(event) => { event.stopPropagation(); onPick?.(row); }} />
                        );
                    })}
                </div>
            </div>
            </div>
            <figcaption>
                {tr(map.label)} · {found} {tr("de")} {visible.length} {tr("graças descobertas. Mapa e posições tirados do seu jogo instalado.")} {' '}{tr("Dourado já descoberta, escuro ainda não, azul fica no subterrâneo. Clique num ponto para ver o nome e descobrir a graça, ou no mapa para aproximar.")} </figcaption>
        </figure>
    );
    if (!filled) return figure;
    return <div className="map-overlay" onClick={() => setFilled(false)}><div className="panel" onClick={(event) => event.stopPropagation()}>{figure}</div></div>;
}
