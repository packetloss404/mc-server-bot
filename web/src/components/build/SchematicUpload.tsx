'use client';

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, SchematicInfo } from '@/lib/api';

interface Props {
  /** Fired after a successful upload so the parent can refresh its schematic list. */
  onUploaded?: (schematic: SchematicInfo) => void;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTS = ['.schem', '.schematic'];

function hasAllowedExt(name: string) {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

export function SchematicUpload({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setSuccess(null);
      if (!hasAllowedExt(file.name)) {
        setError('Only .schem or .schematic files are allowed');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB); max 10 MB`);
        return;
      }
      setUploading(true);
      setProgressLabel(`Uploading ${file.name}...`);
      try {
        const { schematic } = await api.uploadSchematic(file);
        setSuccess(`Uploaded ${schematic.filename}`);
        onUploaded?.(schematic);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
        setProgressLabel('');
      }
    },
    [onUploaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="space-y-2">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          dragging
            ? 'border-teal-500/70 bg-teal-500/5'
            : 'border-zinc-700/60 bg-zinc-900/40 hover:border-zinc-600/80'
        } ${uploading ? 'opacity-60 cursor-progress' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".schem,.schematic"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            // Reset so the same filename can be picked again.
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        <div className="flex items-center gap-2 text-zinc-300">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="text-sm font-medium">
            {uploading
              ? progressLabel || 'Uploading...'
              : 'Drop a .schem or .schematic file, or click to browse'}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500">Max 10 MB. Files are saved to the schematics directory.</p>
      </label>
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            {error}
          </motion.p>
        )}
        {success && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2"
          >
            {success}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
