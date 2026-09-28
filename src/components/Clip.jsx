import React, { useState, useEffect, useMemo } from 'react';
import IldaThumbnail from './IldaThumbnail';
import StaticIldaThumbnail from './StaticIldaThumbnail';
import Mappable from './Mappable';
import { DJLINK_TRACK_MIME, isSongLinkDrag } from '../utils/djLinkTracks';

// Denon reports the assigned deck colour as "#AARRGGBB"; Pro DJ Link as
// "#RRGGBB". CSS wants the 6-digit form, so drop a leading alpha pair if present
// and reject anything unrecognised rather than emit an invalid colour.
const deckColorToCss = (raw) => {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return null;
};

const formatClock = (sec) => {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

const Clip = ({
  clipName,
  layerIndex,
  colIndex,
  pageId, // Add pageId
  onDropGenerator,
  onDropEffect,
  clipContent,
  thumbnailFrameIndex,
  onUnsupportedFile,
  onActivateClick,
  onLabelClick,
  isSelected,
  isActive,
  ildaParserWorker,
  onDropDac, // New prop for handling DAC drops
  onLinkDjTrack, // Bind this clip to a song loaded on a DJ deck
  isDjDriven,   // The deck is currently driving this clip (parent's word, not derived)
  thumbnailRenderMode,
  liveFrame,
  liveProgress,
  stillFrame,
  liveWorkerId,
  liveFramesRef,
  progressRef,
  thumbBpm,
  thumbClipDuration,
  fftLevels,
  cycleFrames,
  cycleInterval,
  cycleEnabled,
  onClipHover,
  onThumbnailError
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLinkTarget, setIsLinkTarget] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);

  // If the thumbnail path or version changes (e.g. a regenerated thumbnail), clear
  // the error latch so the new image is actually shown again.
  useEffect(() => {
    if (thumbnailError) setThumbnailError(false);
  }, [clipContent?.thumbnailPath, clipContent?.thumbnailVersion]);

  // Determine the display name for the clip
  const displayName = clipName;

  const isTempTrigger = clipContent?.triggerStyle === 'temp';
  const shouldShowLive = (thumbnailRenderMode === 'active' && !isTempTrigger) || (thumbnailRenderMode === 'hover' && isHovered);
  const hasActualContent = clipContent && (clipContent.type === 'ilda' || clipContent.type === 'generator');
  const hasLiveFrame = shouldShowLive && (liveFrame || stillFrame);

  // DJ-Link binding badge. `isDjDriven` is the parent's word for "the deck is
  // currently driving this clip" — it is passed in rather than derived here so
  // the badge cannot disagree with the engine about who owns the layer.
  const djLink = hasActualContent && clipContent?.djLink ? clipContent.djLink : null;
  const djLinkActive = !!isDjDriven;
  const djLinkDot = djLink ? deckColorToCss(djLink.deckColor) : null;
  const djLinkTitle = !djLink
    ? ''
    : [
      djLink.title || djLink.trackId,
      djLink.artist,
      djLink.enabled ? null : 'link disabled',
      djLink.follow === 'position'
        ? `follows deck position (${formatClock(djLink.startSec || 0)} - ${formatClock(djLink.endSec || 0)})`
        : `loops every ${djLink.loopBeats || 8} beats`,
      djLink.trigger === 'play' ? 'fires on play' : 'fires on load',
      djLinkActive ? 'deck is driving this clip' : null,
    ].filter(Boolean).join(' — ');

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    // A song being dragged in offers a LINK, not a copy — the clip's content is
    // untouched, it just gains a binding to the track. See isSongLinkDrag for
    // why this cannot simply test for our own MIME.
    const isSongLink = isSongLinkDrag(e.dataTransfer.types);
    setIsLinkTarget(isSongLink);
    e.dataTransfer.dropEffect = isSongLink ? 'link' : 'copy';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
      setIsLinkTarget(false);
    }
  };

  const handleActivate = (isPress) => {
    if (onActivateClick) onActivateClick(layerIndex, colIndex, isPress);
  };

  const handleLabelClick = () => {
    if (onLabelClick) onLabelClick(layerIndex, colIndex);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (onClipHover) onClipHover(layerIndex, colIndex, true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    const triggerStyle = clipContent?.triggerStyle || 'normal';
    if (triggerStyle !== 'flash' && triggerStyle !== 'temp') {
      handleActivate(false);
    }
    if (onClipHover) onClipHover(layerIndex, colIndex, false);
  };

  const handleFileDrop = async (file) => {
    const droppedFileName = file.name;
    if (!ildaParserWorker) {
      onUnsupportedFile("ILDA parser not available.");
      return;
    }

    // Check if it's an ILD file
    if (droppedFileName.toLowerCase().endsWith('.ild')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFileDrop): ${arrayBuffer.byteLength}`);
        ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName: droppedFileName, filePath: file.path, layerIndex, colIndex, pageId }, [arrayBuffer]);
      } catch (error) {
        console.error('[Clip.jsx] handleFileDrop - Error reading file:', error);
        onUnsupportedFile(`Error reading file: ${error.message}`);
      }
    } else {
      onUnsupportedFile("Please drop a valid .ild file");
    }
  };

  // Updated function to use your existing readFileContent API
  const handleFilePathDrop = async (filePath, fileName) => {

    if (!fileName.toLowerCase().endsWith('.ild')) {
      console.log('Unsupported file type:', fileName);
      onUnsupportedFile("Please drop a valid .ild file");
      return;
    }

    if (!ildaParserWorker) {
      onUnsupportedFile("ILDA parser not available.");
      return;
    }

    try {
      // Use readFileAsBinary instead of readFileContent
      if (window.electronAPI && window.electronAPI.readFileAsBinary) {
        const arrayBuffer = await window.electronAPI.readFileAsBinary(filePath);

        if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
          console.error('[Clip.jsx] readFileAsBinary did not return an ArrayBuffer:', arrayBuffer);
          onUnsupportedFile("Error reading file: Invalid data format received.");
          return;
        }

        console.log(`[Clip.jsx] ArrayBuffer byteLength before posting to worker (handleFilePathDrop): ${arrayBuffer.byteLength}`);
        ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName, filePath, layerIndex, colIndex, pageId }, [arrayBuffer]);
      } else {
        onUnsupportedFile("Binary file access not available");
      }
    } catch (error) {
      console.error('Error processing file path:', error);
      console.error('Error stack:', error.stack);
      onUnsupportedFile(`Error processing file: ${error.message}`);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setIsLinkTarget(false);

    // Song link first: it is a distinct MIME, and the payload must never be
    // mistaken for an effect / DAC / generator descriptor.
    const types = Array.from(e.dataTransfer.types || []);
    const linkData = e.dataTransfer.getData(DJLINK_TRACK_MIME);
    if (linkData) {
      try {
        const deck = JSON.parse(linkData);
        console.log(`[DJ-Link] drop on ${layerIndex}-${colIndex}: "${deck.title || deck.trackId}" from ${deck.source} deck ${deck.deckId}`);
        if (onLinkDjTrack) onLinkDjTrack(layerIndex, colIndex, deck);
        else onUnsupportedFile('Song linking is not available here.');
      } catch (error) {
        console.error('Error parsing dropped DJ-Link track:', error);
        onUnsupportedFile('Could not read that song link.');
      }
      return;
    }

    const effectData = e.dataTransfer.getData('application/json');
    if (effectData) {
      try {
        const parsedData = JSON.parse(effectData);

        // Check if this is file path data from the file system
        if (parsedData.filePath && parsedData.fileName) {
          handleFilePathDrop(parsedData.filePath, parsedData.fileName);
          return; // Important: return after handling file path
        }

        if (parsedData.type === 'transform' || parsedData.type === 'animation' || parsedData.type === 'color' || parsedData.type === 'effect') {
          if (onDropEffect) {
            onDropEffect(layerIndex, colIndex, parsedData);
            onLabelClick(); // Select the clip to show its new settings
            return;
          }
        } else if (parsedData.isGroup || (parsedData.ip && (typeof parsedData.channel === 'number' || parsedData.allChannels))) { // Check if this is DAC or DAC Group
          if (onDropDac) {
            onDropDac(layerIndex, colIndex, parsedData);
            return;
          }
        } else if (parsedData.name) {
          if (onDropGenerator) {
            onDropGenerator(layerIndex, colIndex, parsedData);
            return;
          }
        }
      } catch (error) {
        console.error('Error parsing dropped data:', error);
      }
    }

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileDrop(files[0]);
      return;
    }

    // Nothing matched. The drag types are logged because this is where an
    // unrecognised payload lands, and the message names every accepted kind so
    // the operator is not left guessing.
    console.log('[Clip.jsx] unrecognised drop — types:', JSON.stringify(types));
    onUnsupportedFile('Nothing usable in that drop. Clips accept a .ild file, an effect, a generator, a DAC, or a song dragged from the DJ-Link display.');
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.showClipContextMenu) {
      window.electronAPI.showClipContextMenu(layerIndex, colIndex, clipContent?.triggerStyle || 'normal');
    }
  };

  return (
    <div
      className={`clip ${isDragging ? 'dragging' : ''} ${isLinkTarget ? 'link-target' : ''} ${isActive ? 'active-clip' : ''} `} onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      <Mappable id={`clip_${layerIndex}_${colIndex}`}>
        <div
          className="clip-thumbnail"
          onMouseDown={(e) => { if (e.button === 0) handleActivate(true); }}
          onMouseUp={(e) => { if (e.button === 0) handleActivate(false); }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{ overflow: 'hidden' }} // Ensure image fits
        >
          {clipContent && clipContent.parsing ? (
            <div className="clip-loading-spinner"></div>
          ) : (
            <>
              {/* Render Mode Logic */}
              {shouldShowLive && hasActualContent && hasLiveFrame ? (
                /* Live/Hover Render Mode: Use liveFrame (or stillFrame if not playing/available) with IldaThumbnail */
                <IldaThumbnail frame={liveFrame || stillFrame} frames={clipContent?.frames} effects={clipContent?.effects} progress={clipContent?.type === 'generator' ? liveProgress : 0} syncSettings={clipContent?.syncSettings || {}} clipDuration={thumbClipDuration} bpm={thumbBpm || 120} fftLevels={fftLevels} ildaParserWorker={ildaParserWorker} workerId={liveWorkerId} liveFramesRef={liveFramesRef} progressRef={progressRef} cycleFrames={cycleFrames} cycleInterval={cycleInterval} cycleEnabled={cycleEnabled} liveEnabled={thumbnailRenderMode === 'active'} />
              ) : (
                /* Still Frame Mode */
                /* If we have a generated thumbnail path, use it for efficiency */
                (clipContent?.thumbnailPath && !thumbnailError) ? (
                  <img
                    src={`file://${clipContent.thumbnailPath}?t=${clipContent.thumbnailVersion || Date.now()}`} // Add version timestamp to force reload if updated
                    alt="thumbnail"
                    onError={() => {
                        // Older projects or cleared cache: the cached thumbnail file no
                        // longer exists on disk. Log it clearly, then ask the parent to
                        // regenerate it from the clip's frames.
                        console.warn(`Clip.jsx: Thumbnail not found for ${pageId}-${layerIndex}-${colIndex}: ${clipContent?.thumbnailPath} - triggering new generation`);
                        try {
                            setThumbnailError(true);
                            if (onThumbnailError) onThumbnailError(layerIndex, colIndex);
                        } catch (e) {
                            console.error('Clip.jsx: Thumbnail onError handler failed:', e);
                        }
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                  />
                ) : (
                  /* Fallback to 2D Canvas rendering of still frame (much lighter than WebGL) */
                  stillFrame && <StaticIldaThumbnail frame={stillFrame} />
                )
              )}

              {hasActualContent && clipContent?.triggerStyle && clipContent.triggerStyle !== 'normal' && (
                <p className="clip_icons">                            {clipContent.triggerStyle === 'toggle' && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-toggles" viewBox="0 0 16 16">
                    <path d="M4.5 9a3.5 3.5 0 1 0 0 7h7a3.5 3.5 0 1 0 0-7zm7 6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5m-7-14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5m2.45 0A3.5 3.5 0 0 1 8 3.5 3.5 3.5 0 0 1 6.95 6h4.55a2.5 2.5 0 0 0 0-5zM4.5 0h7a3.5 3.5 0 1 1 0 7h-7a3.5 3.5 0 1 1 0-7" />
                  </svg>
                )}
                  {clipContent.triggerStyle === 'flash' && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-lightning-fill" viewBox="0 0 16 16">
                      <path d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9.5H3.5a.5.5 0 0 1-.48-.641z" />
                    </svg>
                  )}
                  {clipContent.triggerStyle === 'temp' && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM7.5 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-3zM8 11a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1z"/>
                    </svg>
                  )}
                </p>
              )}

              {/* DJ-Link song binding. Tinted with the source deck's assigned
                  colour, dimmed when the link is switched off, and marked while
                  the deck is actually driving this clip. */}
              {djLink && (
                <p
                  className={`clip_icons clip_link_badge ${djLink.enabled ? '' : 'disabled'} ${djLinkActive ? 'live' : ''}`}
                  title={djLinkTitle}
                >
                  <span
                    className="clip_link_dot"
                    style={djLinkDot ? { background: djLinkDot, boxShadow: `0 0 5px ${djLinkDot}` } : undefined}
                  />
                  {djLink.follow === 'position' ? 'POS' : 'LOOP'}
                </p>
              )}
            </>
          )}
        </div>
      </Mappable>
      <Mappable id={`clip_${layerIndex}_${colIndex}_preview`}>
        <span className={`clip-label ${isSelected ? 'selected-clip' : ''}`} onClick={handleLabelClick}>{displayName}</span>
      </Mappable>
    </div>
  );
};

export default React.memo(Clip, (prev, next) => {
    // Default shallow-equal check
    for (const k of Object.keys(next)) {
        if (prev[k] !== next[k]) return false;
    }
    return true;
});