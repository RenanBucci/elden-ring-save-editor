import { useState } from 'react';

export default function Icon({ id, size = 40 }) {
    const [failedId, setFailedId] = useState(null);
    const style = size == null ? undefined : { width: size, height: size };
    if (!id || failedId === id) return <span className="icon-empty" style={style} aria-hidden="true">◆</span>;
    const name = String(id).padStart(5, '0');
    return (
        <img
            className="item-icon"
            src={`/icons/icon_${name}.png`}
            style={style}
            alt=""
            loading="lazy"
            onError={() => setFailedId(id)}
        />
    );
}
