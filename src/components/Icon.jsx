import { useEffect, useState } from 'react';
import { call } from '../api';
const cache = new Map();
export default function Icon({ id, size = 40 }) {
    const [loaded, setLoaded] = useState(null);
    useEffect(() => {
        let alive = true;
        if (!id) return undefined;
        if (!cache.has(id)) cache.set(id, call('itemIcon', id));
        cache.get(id).then(result => { if (alive) setLoaded({id, image: result?.ok ? result.image : null}); });
        return () => { alive = false; };
    }, [id]);
    const style = size == null ? undefined : { width: size, height: size };
    if (!id || loaded?.id !== id || !loaded.image) return <span className="icon-empty" style={style} aria-hidden="true">◆</span>;
    return <img className="item-icon" src={loaded.image} style={style} alt="" loading="lazy" />;
}
