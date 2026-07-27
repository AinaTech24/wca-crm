import { useState, useEffect, useRef } from 'react';

// Keeps a component mounted for `ms` after `open` flips to false so an exit
// animation can play. Returns { render, closing }: render true while mounted,
// closing true during the exit window (add a `.closing` class to animate out).
export function useExit(open, ms = 180) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef();

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setRender(true);
      setClosing(false);
    } else if (render) {
      setClosing(true);
      timer.current = setTimeout(() => { setRender(false); setClosing(false); }, ms);
    }
    return () => clearTimeout(timer.current);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return { render, closing };
}
