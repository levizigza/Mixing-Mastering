'use client';

import React, { useMemo, useEffect, useCallback, useState, useRef } from 'react';
import { useProAudioEngine } from '@/hooks/useProAudioEngine';
import AudioUpload from '@/components/AudioUpload';
import ChannelStrip from '@/components/ChannelStrip';
import MasterSection from '@/components/MasterSection';
import ParametricEQ from '@/components/ParametricEQ';
import SpectrumAnalyzer from '@/components/SpectrumAnalyzer';
import WaveformDisplay from '@/components/WaveformDisplay';
import TransportControls from '@/components/TransportControls';
import InsightsPanel from '@/components/InsightsPanel';
import PresetSelector from '@/components/PresetSelector';
import StereoScope from '@/components/StereoScope';
import ProMeteringPanel from '@/components/ProMeteringPanel';
import ExportPanel from '@/components/ExportPanel';
import SidechainPanel from '@/components/SidechainPanel';
import ReferenceTrack from '@/components/ReferenceTrack';
import LoudnessTarget from '@/components/LoudnessTarget';
import AutomationPanel from '@/components/AutomationPanel';
import { AutomationLaneData } from '@/components/AutomationLane';
import TransientPanel from '@/components/TransientPanel';
import BeatOptimizer from '@/components/BeatOptimizer';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import MarkerTimeline from '@/components/MarkerTimeline';
import AutoMasterReport from '@/components/AutoMasterReport';
import LevelingReport from '@/components/LevelingReport';
import BeatStationReport from '@/components/BeatStationReport';
import AutotuneReport from '@/components/AutotuneReport';
import VocalFixReport from '@/components/VocalFixReport';
import RepairReport from '@/components/RepairReport';
import AssemblyLineReport from '@/components/AssemblyLineReport';
import BusPanel from '@/components/BusPanel';
import RecordPanel from '@/components/RecordPanel';
import TimelineEditor from '@/components/TimelineEditor';
import VideoSyncPanel from '@/components/VideoSyncPanel';
import DeliveryPanel from '@/components/DeliveryPanel';
import SoundEnhancerSettings from '@/components/SoundEnhancerSettings';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import Tooltip from '@/components/ui/Tooltip';
import { Headphones, Cpu, Zap, Undo2, Redo2, HelpCircle, RotateCcw, Radio } from 'lucide-react';
import { STATION_THEMES, StationId } from '@/lib/station-theme';

export default function StudioPage() {
  const {
    stems,
    masterProcessing,
    transport,
    abBypass,
    selectedStemId,
    activePresetId,
    masterMeter,
    proMeter,
    spectrumData,
    stemMeters,
    isExporting,
    exportProgress,
    exportBitDepth,
    exportDither,
    engineReady,
    workletsAvailable,
    addStems,
    removeStem,
    updateStemProcessing,
    updateMasterProcessing,
    setSelectedStemId,
    setExportBitDepth,
    setExportDither,
    play,
    pause,
    stop,
    rewind,
    seek,
    toggleLoop,
    setLoopFromRegion,
    toggleABBypass,
    applyPreset,
    exportWAV,
    exportStemFile,
    exportAllStems,
    saveSession,
    loadSession,
    loudnessOffset,
    pushHistory,
    undo,
    redo,
    historyIndex,
    historyLength,
    sidechainRoutes,
    connectSidechain,
    disconnectSidechain,
    updateSidechainParams,
    automationLanes,
    setAutomationLanes,
    exportFormat,
    setExportFormat,
    doExport,
    bounceDelivery,
    bounceMode,
    metadata,
    setDeliveryMetadata,
    setBounceMode,
    updateTransientParams,
    updateGateParams,
    markers,
    regions,
    addMarker,
    removeMarker,
    addRegion,
    removeRegion,
    reorderStems,
    duplicateStem,
    buses,
    clips,
    sections,
    videoOffsetMs,
    setVideoOffsetMs,
    snapEnabled,
    setSnapEnabled,
    updateBus,
    updateStemSend,
    setTrackRole,
    updateClip,
    removeClip,
    splitClip,
    addSection,
    removeSection,
    isRepairing,
    repairProgress,
    repairMessage,
    repairResult,
    repairTrackName,
    runRepair,
    setRepairResult,
    isAssemblyLine,
    assemblyProgress,
    assemblyMessage,
    assemblyStage,
    assemblyResult,
    assemblyTrackName,
    runAssemblyLine,
    cancelAssemblyLine,
    setAssemblyResult,
    isArmed,
    isRecording,
    inputPeak,
    recordElapsed,
    metronomeEnabled,
    setMetronomeEnabled,
    armRecorder,
    disarmRecorder,
    startRecording,
    stopRecording,
    swapStationAB,
    isQuickMastering,
    quickMasterProgress,
    quickMasterMessage,
    quickMasterResult,
    quickMasterTrackName,
    runQuickMaster,
    setQuickMasterResult,
    isAutoMixing,
    autoMixProgress,
    autoMixMessage,
    runAutoMix,
    isAutoLeveling,
    autoLevelProgress,
    autoLevelMessage,
    autoLevelResult,
    autoLevelTrackName,
    runAutoLevel,
    setAutoLevelResult,
    isAutotuning,
    autotuneProgress,
    autotuneMessage,
    autotuneResult,
    autotuneTrackName,
    runAutotune,
    setAutotuneResult,
    isVocalFixing,
    vocalFixProgress,
    vocalFixMessage,
    vocalFixResult,
    vocalFixTrackName,
    runVocalFix,
    setVocalFixResult,
    isBeatStation,
    beatStationProgress,
    beatStationMessage,
    beatStationNotes,
    beatStationPreset,
    beatStationTrackName,
    runBeatStation,
    setBeatStationNotes,
    isOptimizingBeat,
    beatOptimizeProgress,
    beatOptimizeMessage,
    beatAnalysis,
    runBeatOptimize,
    resetSession,
  } = useProAudioEngine();

  const dragIndexRef = useRef<number | null>(null);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeStation, setActiveStation] = useState<StationId>('automaster');
  const activeTheme = STATION_THEMES[activeStation];

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      if (e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 's') { e.preventDefault(); saveSession(); }
    }
    if (e.code === 'Space' && !e.target) {
      e.preventDefault();
      transport.isPlaying ? pause() : play();
    }
    if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
      setShowShortcuts((prev) => !prev);
    }
  }, [undo, redo, saveSession, transport.isPlaying, pause, play]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const selectedStem = stems.find((s) => s.id === selectedStemId);

  // Generate stereo scope data from spectrum
  const scopeDataL = useMemo(() => {
    if (!spectrumData) return null;
    return new Float32Array(spectrumData.length).map((_, i) =>
      Math.sin(i * 0.01) * (spectrumData[i] + 100) / 100 * 0.3
    );
  }, [spectrumData]);

  const scopeDataR = useMemo(() => {
    if (!spectrumData) return null;
    return new Float32Array(spectrumData.length).map((_, i) =>
      Math.cos(i * 0.01) * (spectrumData[i] + 100) / 100 * 0.3
    );
  }, [spectrumData]);

  return (
    <div className="h-screen flex flex-col bg-studio-bg relative mixer-bed">

      {/* Console Header */}
      <header className="console-header flex items-center justify-between px-4 py-2.5 border-b border-studio-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md flex items-center justify-center border border-studio-accent/40 bg-studio-accent/10">
              <Headphones size={16} className="text-studio-accent" />
            </div>
            <div>
              <h1 className="font-display text-[11px] font-semibold text-studio-text tracking-[0.18em]">
                MIXING &amp; MASTERING
              </h1>
              <p className="text-[8px] font-mono text-studio-muted tracking-wider">CONSOLE · OPEN STUDIO</p>
            </div>
          </div>
          <div
            className="hidden sm:flex items-center gap-2 ml-2 pl-3 border-l border-studio-border"
            style={{ borderLeftColor: `${activeTheme.color}44` }}
          >
            <Radio size={12} style={{ color: activeTheme.color }} />
            <div>
              <p className="text-[8px] font-mono text-studio-muted tracking-wider">ACTIVE BAY</p>
              <p className="font-display text-[10px] tracking-[0.12em]" style={{ color: activeTheme.color }}>
                {activeTheme.short} — {activeTheme.title.toUpperCase()}
              </p>
            </div>
            <span
              className="studio-led studio-led-on ml-1"
              style={{ background: activeTheme.color, color: activeTheme.color }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Tooltip content="Undo (Ctrl+Z)">
              <button
                onClick={() => { pushHistory(); undo(); }}
                disabled={historyIndex <= 0}
                className="p-1 rounded hover:bg-white/5 disabled:opacity-20 transition-opacity"
              >
                <Undo2 size={12} className="text-studio-muted" />
              </button>
            </Tooltip>
            <Tooltip content="Redo (Ctrl+Shift+Z)">
              <button
                onClick={redo}
                disabled={historyIndex >= historyLength - 1}
                className="p-1 rounded hover:bg-white/5 disabled:opacity-20 transition-opacity"
              >
                <Redo2 size={12} className="text-studio-muted" />
              </button>
            </Tooltip>
          </div>
          {workletsAvailable ? (
            <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1">
              <Zap size={10} /> DSP LIVE
            </span>
          ) : (
            <span className="text-[9px] font-mono text-yellow-400 flex items-center gap-1">
              <Cpu size={10} /> FALLBACK
            </span>
          )}
          <span className="text-[10px] font-mono text-studio-muted tabular-nums">
            {stems.length} CH
          </span>
          {abBypass && (
            <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded animate-pulse">
              BYPASS
            </span>
          )}
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-1 rounded hover:bg-white/5 transition-opacity"
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle size={13} className="text-studio-muted" />
          </button>
        </div>
      </header>

      {/* Transport */}
      <TransportControls
        transport={transport}
        abBypass={abBypass}
        isExporting={isExporting}
        exportProgress={exportProgress}
        onPlay={play}
        onPause={pause}
        onStop={stop}
        onRewind={rewind}
        onToggleLoop={toggleLoop}
        onToggleABBypass={toggleABBypass}
        onExport={exportWAV}
      />

      {/* Waveform */}
      <div className="px-2 py-1">
        <WaveformDisplay
          stems={stems}
          currentTime={transport.currentTime}
          duration={transport.duration}
          onSeek={seek}
        />
      </div>

      {/* Timeline clips + song sections */}
      {stems.length > 0 && (
        <div className="px-2 pb-1">
          <TimelineEditor
            stems={stems}
            clips={clips}
            sections={sections}
            duration={transport.duration}
            currentTime={transport.currentTime}
            bpm={beatAnalysis?.bpm}
            snapEnabled={snapEnabled}
            onSeek={seek}
            onUpdateClip={updateClip}
            onRemoveClip={removeClip}
            onSplitClip={splitClip}
            onAddSection={addSection}
            onRemoveSection={removeSection}
            onToggleSnap={() => setSnapEnabled((v) => !v)}
          />
        </div>
      )}

      {/* Markers & Regions */}
      {transport.duration > 0 && (
        <div className="px-2">
          <MarkerTimeline
            duration={transport.duration}
            currentTime={transport.currentTime}
            markers={markers}
            regions={regions}
            onAddMarker={addMarker}
            onRemoveMarker={removeMarker}
            onAddRegion={(region) => {
              addRegion(region);
            }}
            onRemoveRegion={removeRegion}
            onSeek={seek}
          />
          {regions.length > 0 && (
            <div className="flex gap-1 mt-1 mb-1">
              {regions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setLoopFromRegion(r.id)}
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-studio-border text-studio-muted hover:text-amber-300 hover:border-amber-500/40"
                >
                  LOOP {r.label || 'REGION'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden px-2 pb-2 gap-2">
        {/* Left: Processing bays */}
        <div className="w-[268px] flex flex-col gap-2 overflow-y-auto shrink-0 pr-0.5">
          <AudioUpload
            onFilesSelected={addStems}
            onQuickMaster={runQuickMaster}
            onAutoMix={runAutoMix}
            onAutoLevel={runAutoLevel}
            onBeatStation={runBeatStation}
            onAutotune={runAutotune}
            onVocalFix={runVocalFix}
            onRepair={runRepair}
            onAssemblyLine={runAssemblyLine}
            onCancelAssemblyLine={cancelAssemblyLine}
            onStationChange={setActiveStation}
            existingStems={stems.map((s) => s.name)}
            isQuickMastering={isQuickMastering}
            quickMasterProgress={quickMasterProgress}
            quickMasterMessage={quickMasterMessage}
            isAutoMixing={isAutoMixing}
            autoMixProgress={autoMixProgress}
            autoMixMessage={autoMixMessage}
            isAutoLeveling={isAutoLeveling}
            autoLevelProgress={autoLevelProgress}
            autoLevelMessage={autoLevelMessage}
            isBeatStation={isBeatStation}
            beatStationProgress={beatStationProgress}
            beatStationMessage={beatStationMessage}
            isAutotuning={isAutotuning}
            autotuneProgress={autotuneProgress}
            autotuneMessage={autotuneMessage}
            isVocalFixing={isVocalFixing}
            vocalFixProgress={vocalFixProgress}
            vocalFixMessage={vocalFixMessage}
            isRepairing={isRepairing}
            repairProgress={repairProgress}
            repairMessage={repairMessage}
            isAssemblyLine={isAssemblyLine}
            assemblyProgress={assemblyProgress}
            assemblyMessage={assemblyMessage}
            assemblyStage={assemblyStage}
          />
          <RecordPanel
            isArmed={isArmed}
            isRecording={isRecording}
            inputPeak={inputPeak}
            elapsed={recordElapsed}
            metronome={metronomeEnabled}
            onArm={() => void armRecorder()}
            onDisarm={disarmRecorder}
            onStart={() => void startRecording()}
            onStop={() => void stopRecording()}
            onToggleMetronome={() => setMetronomeEnabled((v) => !v)}
          />
          <BusPanel
            buses={buses}
            selectedStemId={selectedStemId}
            stemSends={selectedStem?.sends ?? {}}
            onBusChange={updateBus}
            onStemSendChange={(fx, level) => {
              if (selectedStemId) updateStemSend(selectedStemId, fx, level);
            }}
          />
          <DeliveryPanel
            metadata={metadata}
            bounceMode={bounceMode}
            onMetadataChange={setDeliveryMetadata}
            onBounceModeChange={setBounceMode}
            onBounce={() => void bounceDelivery()}
            isExporting={isExporting}
            exportProgress={exportProgress}
          />
          <VideoSyncPanel
            isPlaying={transport.isPlaying}
            currentTime={transport.currentTime}
            videoOffsetMs={videoOffsetMs}
            onOffsetChange={setVideoOffsetMs}
          />
          <button
            onClick={resetSession}
            disabled={stems.length === 0 && !quickMasterResult && !autoLevelResult && !beatStationNotes && !autotuneResult && !vocalFixResult && !repairResult && !assemblyResult}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-red-500/25 bg-red-500/5 hover:bg-red-500/15 text-red-300/80 hover:text-red-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-[10px] font-mono tracking-wider"
          >
            <RotateCcw size={12} />
            RESET SESSION
          </button>
          {quickMasterResult && (
            <AutoMasterReport
              analysis={quickMasterResult.analysis}
              recommendations={quickMasterResult.recommendations}
              trackName={quickMasterTrackName}
              separatedStemAnalysis={quickMasterResult.separatedStemAnalysis}
              masteringStats={quickMasterResult.masteringStats}
              onDismiss={() => setQuickMasterResult(null)}
            />
          )}
          {autoLevelResult && (
            <LevelingReport
              result={autoLevelResult}
              trackName={autoLevelTrackName}
              onDismiss={() => setAutoLevelResult(null)}
            />
          )}
          {beatStationNotes && (
            <BeatStationReport
              trackName={beatStationTrackName}
              presetName={beatStationPreset}
              notes={beatStationNotes}
              bpm={beatAnalysis?.bpm}
              onDismiss={() => setBeatStationNotes(null)}
            />
          )}
          {autotuneResult && (
            <AutotuneReport
              result={autotuneResult}
              trackName={autotuneTrackName}
              onDismiss={() => setAutotuneResult(null)}
              onSwapAB={() => {
                const processed = stems.find((s) => s.name.includes(autotuneTrackName) && !s.name.includes('Original'));
                if (processed) swapStationAB(processed.id);
              }}
            />
          )}
          {vocalFixResult && (
            <VocalFixReport
              result={vocalFixResult}
              trackName={vocalFixTrackName}
              onDismiss={() => setVocalFixResult(null)}
              onSwapAB={() => {
                const processed = stems.find((s) => s.name.includes(vocalFixTrackName) && !s.name.includes('Original'));
                if (processed) swapStationAB(processed.id);
              }}
            />
          )}
          {repairResult && (
            <RepairReport
              trackName={repairTrackName}
              stages={repairResult.stages}
              notes={repairResult.notes}
              onDismiss={() => setRepairResult(null)}
              onSwapAB={() => {
                const processed = stems.find((s) => s.name.includes(repairTrackName) && !s.name.includes('Original'));
                if (processed) swapStationAB(processed.id);
              }}
            />
          )}
          {assemblyResult && (
            <AssemblyLineReport
              result={assemblyResult}
              trackName={assemblyTrackName}
              onDismiss={() => setAssemblyResult(null)}
              onSwapAB={() => {
                const processed = stems.find(
                  (s) => s.name.includes(assemblyTrackName) && s.name.includes('Final')
                );
                if (processed) swapStationAB(processed.id);
              }}
            />
          )}
          <SoundEnhancerSettings />
          <PresetSelector
            activePresetId={activePresetId}
            onSelectPreset={applyPreset}
          />
          <ExportPanel
            bitDepth={exportBitDepth}
            dither={exportDither}
            format={exportFormat}
            isExporting={isExporting}
            exportProgress={exportProgress}
            stemCount={stems.length}
            onBitDepthChange={setExportBitDepth}
            onDitherChange={setExportDither}
            onFormatChange={setExportFormat}
            onExport={doExport}
            onExportAllStems={exportAllStems}
            onSaveSession={saveSession}
            onLoadSession={loadSession}
          />
          <InsightsPanel stems={stems} />
          <SidechainPanel
            stems={stems}
            selectedStemId={selectedStemId}
            sidechainRoutes={sidechainRoutes}
            onConnect={connectSidechain}
            onDisconnect={disconnectSidechain}
            onUpdateParams={updateSidechainParams}
          />
          <TransientPanel
            stemId={selectedStemId}
            onUpdateTransient={updateTransientParams}
            onUpdateGate={updateGateParams}
          />
          <BeatOptimizer
            stemId={selectedStemId}
            stemName={selectedStem?.name}
            stemType={selectedStem?.type}
            analysis={beatAnalysis}
            isOptimizing={isOptimizingBeat}
            optimizeProgress={beatOptimizeProgress}
            optimizeMessage={beatOptimizeMessage}
            onOptimize={runBeatOptimize}
          />
        </div>

        {/* Center: Channel Strips */}
        <div className="flex-1 flex flex-col gap-2 overflow-hidden">
          {/* Mixer */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex gap-2 h-full min-w-0">
              {stems.length === 0 ? (
                <div className="flex-1 flex items-center justify-center studio-rack">
                  <div className="text-center space-y-3 px-6 max-w-sm">
                    <div
                      className="mx-auto w-14 h-14 rounded-md flex items-center justify-center border"
                      style={{
                        borderColor: `${activeTheme.color}55`,
                        background: activeTheme.glow,
                        color: activeTheme.color,
                      }}
                    >
                      <Headphones size={28} />
                    </div>
                    <p className="font-display text-[12px] tracking-[0.16em] text-studio-text">
                      MIXER IDLE
                    </p>
                    <p className="text-[11px] text-studio-muted leading-relaxed">
                      Select a colored bay on the left —{' '}
                      <span style={{ color: activeTheme.color }}>{activeTheme.title}</span>
                      {' '}is armed. Drop audio into that bay to process.
                    </p>
                    <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                      {Object.values(STATION_THEMES).map((s) => (
                        <span
                          key={s.id}
                          className="text-[8px] font-mono px-1.5 py-0.5 rounded border"
                          style={{
                            color: s.color,
                            borderColor: `${s.color}44`,
                            background: s.glow,
                          }}
                        >
                          {s.short}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                stems.map((stem, index) => (
                  <ChannelStrip
                    key={stem.id}
                    stem={stem}
                    isSelected={stem.id === selectedStemId}
                    onSelect={() => setSelectedStemId(stem.id)}
                    onUpdate={(updates) => updateStemProcessing(stem.id, updates)}
                    onRemove={() => removeStem(stem.id)}
                    onDuplicate={() => duplicateStem(stem.id)}
                    onExportStem={() => exportStemFile(stem.id)}
                    onTrackRoleChange={(role) => setTrackRole(stem.id, role)}
                    onDragStart={() => { dragIndexRef.current = index; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
                        reorderStems(dragIndexRef.current, index);
                      }
                      dragIndexRef.current = null;
                    }}
                    meterValue={stemMeters[stem.id] ?? -Infinity}
                  />
                ))
              )}
            </div>
          </div>

          {/* Automation */}
          {selectedStem && (
            <div className="shrink-0">
              <AutomationPanel
                stemId={selectedStem.id}
                stemName={selectedStem.name}
                duration={transport.duration}
                currentTime={transport.currentTime}
                lanes={(automationLanes[selectedStem.id] || []) as AutomationLaneData[]}
                onLanesChange={(lanes) => setAutomationLanes((prev: Record<string, any[]>) => ({ ...prev, [selectedStem.id]: lanes }))}
              />
            </div>
          )}

          {/* Bottom: EQ + Spectrum for selected stem */}
          <div className="flex gap-2 shrink-0">
            <div className="flex-1">
              <ParametricEQ
                bands={selectedStem?.processing.eq ?? masterProcessing.eq}
                onChange={(bands) => {
                  if (selectedStem) {
                    updateStemProcessing(selectedStem.id, { eq: bands });
                  } else {
                    updateMasterProcessing({ eq: bands });
                  }
                }}
                color={selectedStem ? undefined : '#f97316'}
              />
            </div>
            <div className="flex-1">
              <SpectrumAnalyzer data={spectrumData} />
            </div>
          </div>
        </div>

        {/* Right Sidebar: Master + Pro Metering + Stereo Scope */}
        <div className="w-[230px] shrink-0 overflow-y-auto space-y-2">
          <MasterSection
            processing={masterProcessing}
            meter={masterMeter}
            onUpdate={updateMasterProcessing}
          />
          <ProMeteringPanel meter={proMeter} />
          <LoudnessTarget meter={proMeter} />
          <ReferenceTrack isPlaying={transport.isPlaying} currentTime={transport.currentTime} />
          <StereoScope dataL={scopeDataL} dataR={scopeDataR} width={200} height={160} />
        </div>
      </div>
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
