import { useEffect } from 'react';
import type { PromotionPiece } from './moves';

const PIECES: { piece: PromotionPiece; label: string; white: string; black: string }[] = [
  { piece: 'q', label: 'ферзь', white: '♕', black: '♛' },
  { piece: 'r', label: 'ладья', white: '♖', black: '♜' },
  { piece: 'b', label: 'слон', white: '♗', black: '♝' },
  { piece: 'n', label: 'конь', white: '♘', black: '♞' },
];

interface Props {
  color: 'w' | 'b';
  onPick(piece: PromotionPiece): void;
  onCancel(): void;
}

export function PromotionPicker({ color, onPick, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="promotion" role="dialog" aria-label="Превращение пешки">
      {PIECES.map((p) => (
        <button key={p.piece} type="button" aria-label={p.label} onClick={() => onPick(p.piece)}>
          {color === 'w' ? p.white : p.black}
        </button>
      ))}
      <button type="button" className="cancel" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}
