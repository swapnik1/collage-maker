import { useRef, useState } from 'react';
import { MAX_PHOTOS, Photo } from '../types';
import PhotoThumb from './PhotoThumb';

interface Props {
  photos: Photo[];
  order: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (files: File[]) => void;
}

export default function PhotoList({ photos, order, selected, onSelect, onRemove, onReorder, onAdd }: Props) {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const ordered = order.map((id) => byId.get(id)).filter((p): p is Photo => !!p);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = ordered.length >= MAX_PHOTOS;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Photos</h2>
        <span className="count">
          {ordered.length}/{MAX_PHOTOS}
        </span>
      </div>

      <div className="photo-list">
        {ordered.map((photo, i) => (
          <div
            key={photo.id}
            className={[
              'photo-row',
              selected === photo.id ? 'is-selected' : '',
              dragIndex === i ? 'is-dragging' : '',
              overIndex === i && dragIndex !== null && dragIndex !== i ? 'is-over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onClick={() => onSelect(photo.id)}
          >
            <span className="photo-index">{i + 1}</span>
            <PhotoThumb photo={photo} size={40} />
            <div className="photo-meta">
              <span className="photo-name" title={photo.name}>
                {photo.name}
              </span>
              <span className="photo-dims">
                {photo.width} × {photo.height}
              </span>
            </div>
            <button
              className="icon-btn"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(photo.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button className="btn subtle full" disabled={full} onClick={() => inputRef.current?.click()}>
        {full ? `Limit is ${MAX_PHOTOS} photos` : '+ Add photos'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <p className="note">Drag to reorder — order drives how the layout is arranged.</p>
    </div>
  );
}
