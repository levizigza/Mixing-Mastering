'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Music, X, Volume2, VolumeX, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Knob from '@/components/ui/Knob';

interface ReferenceTrackProps {
  isPlaying: boolean;
  currentTime: number;
}

export default function ReferenceTrack({ isPlaying, currentTime }: ReferenceTrackProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const [loaded, setLoaded] = useState(false);
  const [fileName, setFileName] = useState('');
  const [refPlaying, setRefPlaying] = useState(false);
  const [gain, setGain] = useState(0); // dB
  const [muted, setMuted] = useState(false);
  const [refLUFS, setRefLUFS] = useState<number>(-Infinity);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      gainRef.current = audioContextRef.current.createGain();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.85;
      gainRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
    return audioContextRef.current;
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const ctx = getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    bufferRef.current = buffer;
    setFileName(file.name.replace(/\.[^.]+$/, ''));
    setLoaded(true);

    // Estimate LUFS from RMS
    const data = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    setRefLUFS(rms > 0 ? 20 * Math.log10(rms) - 0.691 : -Infinity);
  }, [getContext]);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    e.target.value = '';
  };

  const playRef = useCallback(() => {
    if (!bufferRef.current || !audioContextRef.current || !gainRef.current) return;
    stopRef();
    const source = audioContextRef.current.createBufferSource();
    source.buffer = bufferRef.current;
    source.connect(gainRef.current);
    source.start(0, currentTime);
    sourceRef.current = source;
    setRefPlaying(true);
  }, [currentTime]);

  const stopRef = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    setRefPlaying(false);
  }, []);

  // Sync play/stop with main transport
  useEffect(() => {
    if (isPlaying && loaded && !muted) {
      playRef();
    } else {
      stopRef();
    }
  }, [isPlaying, loaded, muted]);

  // Gain
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = muted ? 0 : Math.pow(10, gain / 20);
    }
  }, [gain, muted]);

  // Spectrum visualization
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser || !refPlaying) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.beginPath();
      const barCount = 32;
      const binStep = Math.floor(data.length / barCount);

      for (let i = 0; i < barCount; i++) {
        const val = data[i * binStep];
        const normalized = Math.max(0, (val + 100) / 100);
        const barH = normalized * h;
        const x = (i / barCount) * w;
        const barW = w / barCount - 1;
        ctx.fillStyle = 'rgba(249, 115, 22, 0.4)';
        ctx.fillRect(x, h - barH, barW, barH);
      }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [refPlaying]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopRef();
      audioContextRef.current?.close();
    };
  }, []);

  return (
    <div className="studio-panel p-3 space-y-2">
      <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider flex items-center gap-1.5">
        <Music size={11} className="text-orange-400" />
        Reference Track
      </h3>

      {!loaded ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full studio-button flex items-center justify-center gap-2 py-3 border-dashed border-studio-border"
        >
          <Music size={14} className="text-studio-muted" />
          <span className="text-[10px] text-studio-muted">Load reference track</span>
        </button>
      ) : (
        <div className="space-y-2">
          {/* File info */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-studio-text truncate flex-1">{fileName}</span>
            <button onClick={() => { stopRef(); setLoaded(false); bufferRef.current = null; }}
              className="text-red-400 hover:text-red-300 ml-2">
              <X size={10} />
            </button>
          </div>

          {/* Spectrum mini-display */}
          <canvas
            ref={canvasRef}
            width={200}
            height={24}
            className="w-full rounded bg-studio-bg"
          />

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMuted(!muted)}
              className={cn('p-1 rounded', muted ? 'text-red-400' : 'text-green-400')}
            >
              {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <div className="flex-1 flex flex-col items-center">
              <Knob
                value={gain}
                min={-24}
                max={12}
                defaultValue={0}
                label="Gain"
                size="sm"
                onChange={setGain}
              />
              <span className="text-[8px] font-mono text-studio-muted">{gain > 0 ? '+' : ''}{gain.toFixed(1)} dB</span>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-mono text-studio-muted">EST. LUFS</div>
              <div className="text-[10px] font-mono text-orange-400 tabular-nums">
                {refLUFS > -Infinity ? refLUFS.toFixed(1) : '-∞'}
              </div>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
}
