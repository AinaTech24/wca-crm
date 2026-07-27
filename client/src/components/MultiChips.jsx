import { Ic } from './Icons.jsx';

// Simple multi-select as toggleable chips (used for motor add-on covers).
export default function MultiChips({ options, value = [], onChange }) {
  const set = new Set(value);
  const toggle = (o) => { const n = new Set(set); n.has(o) ? n.delete(o) : n.add(o); onChange([...n]); };
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={'chip' + (set.has(o) ? ' on' : '')} onClick={() => toggle(o)}>
          {set.has(o) && <Ic name="check" size={13} />}
          {o}
        </button>
      ))}
    </div>
  );
}
