'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, Key, ExternalLink } from 'lucide-react';
import { getStoredApiKey, setStoredApiKey } from '@/lib/sound-enhancer';

export default function SoundEnhancerSettings() {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiKey(getStoredApiKey());
  }, []);

  const handleSave = () => {
    setStoredApiKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isConfigured = apiKey.trim().length > 0;

  return (
    <div className="studio-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-cyan-400" />
        <h3 className="text-xs font-semibold text-studio-text">Sound Enhancement</h3>
        {isConfigured && (
          <span className="text-[9px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded font-mono">
            ON
          </span>
        )}
      </div>

      <p className="text-[10px] text-studio-muted leading-relaxed">
        Adds atmospheric sounds (textures, ambience, FX) matched to your track&apos;s character using Freesound&apos;s free library.
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Key size={10} className="text-studio-muted" />
          <label className="text-[10px] text-studio-muted font-medium">
            Freesound API Key
          </label>
          <a
            href="https://freesound.org/apiv2/apply/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5"
          >
            Get free key <ExternalLink size={8} />
          </a>
        </div>
        <div className="flex gap-1.5">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your API key..."
            className="flex-1 bg-studio-bg border border-studio-border rounded px-2 py-1 text-[10px] text-studio-text placeholder:text-studio-muted/40 focus:border-cyan-500/50 focus:outline-none"
          />
          <button
            onClick={handleSave}
            className="px-2 py-1 bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] text-cyan-300 hover:bg-cyan-500/30 transition-colors"
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      {!isConfigured && (
        <p className="text-[9px] text-yellow-400/70">
          Without an API key, Quick Master runs without sound enhancement.
        </p>
      )}
    </div>
  );
}
