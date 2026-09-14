import React, { useState, useEffect, useCallback, useRef } from 'react';
import StaticIldaThumbnail from './StaticIldaThumbnail';
import { useThumbnailWorker } from '../contexts/ThumbnailWorkerContext';

const FileBrowser = ({ onDropIld, viewMode = 'list', onViewModeChange, path, onPathChange }) => {
  const [ildFiles, setIldFiles] = useState([]);
  const [thumbnails, setThumbnails] = useState({});
  const [invalidFiles, setInvalidFiles] = useState(new Set());
  const [loadingThumbnails, setLoadingThumbnails] = useState(new Set());
  const ildaParserWorker = useThumbnailWorker();
  const requestedThumbnailsRef = useRef(new Set());
  const processingQueueRef = useRef([]);
  const isProcessingRef = useRef(false);
  const fileStatsCacheRef = useRef({});

  const selectedDirectory = path;
  const setSelectedDirectory = onPathChange;

  const getCacheKey = (filePath, stats) => {
    return `thumb_${btoa(filePath).replace(/[/+=]/g, '_')}_${stats.size}_${stats.mtime}.png`;
  };

  const loadCachedThumbnail = useCallback(async (filePath, stats) => {
    const cacheKey = getCacheKey(filePath, stats);
    const arrayBuffer = await window.electronAPI.getCachedThumbnail(cacheKey);
    if (arrayBuffer) {
      try {
        const blob = new Blob([arrayBuffer], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        return bitmap;
      } catch (e) {
        console.error('[FileBrowser] Failed to create ImageBitmap from cached thumbnail:', e);
      }
    }
    return null;
  }, []);

  const saveThumbnailToCache = useCallback(async (filePath, stats, bitmap) => {
    const cacheKey = getCacheKey(filePath, stats);
    const canvas = new OffscreenCanvas(128, 128);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 128, 128);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await blob.arrayBuffer();
    await window.electronAPI.saveThumbnail(arrayBuffer, cacheKey);
  }, []);

  const processNextInQueue = useCallback(() => {
    if (isProcessingRef.current || processingQueueRef.current.length === 0 || !ildaParserWorker) {
        return;
    }

    isProcessingRef.current = true;
    const filePath = processingQueueRef.current.shift();
    const fileName = filePath.split(/[/\\]/).pop();

    ildaParserWorker.postMessage({
        type: 'load-and-parse-ilda',
        fileName,
        filePath,
        browserFile: true,
        stopAtFirstFrame: true
    });
  }, [ildaParserWorker]);

  useEffect(() => {
    if (!ildaParserWorker) return;

    const handleMessage = (e) => {
      if (e.data.browserFile) {
        if (e.data.type === 'parse-ilda') {
          if (e.data.success) {
            ildaParserWorker.postMessage({
                type: 'get-frame',
                workerId: e.data.workerId,
                frameIndex: 0,
                browserFile: true,
                filePath: e.data.filePath
            });
          } else {
            console.warn(`[FileBrowser] Skipping invalid ILDA file: ${e.data.filePath}. Reason: ${e.data.error}`);
            setInvalidFiles(prev => new Set(prev).add(e.data.filePath));
            setLoadingThumbnails(prev => { const next = new Set(prev); next.delete(e.data.filePath); return next; });
            isProcessingRef.current = false;
            processNextInQueue();
          }
        } else if (e.data.type === 'get-frame') {
          if (e.data.success) {
            const bitmap = e.data.bitmap || e.data.frame;
            setThumbnails(prev => ({
                ...prev,
                [e.data.filePath]: bitmap
            }));
            const stats = fileStatsCacheRef.current[e.data.filePath];
            if (stats && bitmap instanceof ImageBitmap) {
              saveThumbnailToCache(e.data.filePath, stats, bitmap).catch(console.error);
            }
          }
          setLoadingThumbnails(prev => { const next = new Set(prev); next.delete(e.data.filePath); return next; });
          isProcessingRef.current = false;
          processNextInQueue();
        }
      }
    };

    ildaParserWorker.addEventListener('message', handleMessage);
    return () => ildaParserWorker.removeEventListener('message', handleMessage);
  }, [ildaParserWorker, processNextInQueue, saveThumbnailToCache]);

  const loadThumbnailsForFiles = useCallback(async (files) => {
    if (!files.length) return;
    
    const statsPromises = files.map(filePath => window.electronAPI.getFileStats(filePath));
    const statsResults = await Promise.all(statsPromises);
    
    files.forEach((filePath, index) => {
      const stats = statsResults[index];
      if (stats) {
        fileStatsCacheRef.current[filePath] = stats;
      }
    });

    const cachedThumbnails = await Promise.all(
      files.map(async (filePath, index) => {
        const stats = statsResults[index];
        if (!stats) return { filePath, bitmap: null };
        const bitmap = await loadCachedThumbnail(filePath, stats);
        return { filePath, bitmap };
      })
    );

    const newThumbnails = {};
    const toGenerate = [];
    cachedThumbnails.forEach(({ filePath, bitmap }) => {
      if (bitmap) {
        newThumbnails[filePath] = bitmap;
      } else {
        toGenerate.push(filePath);
      }
    });

    if (Object.keys(newThumbnails).length > 0) {
      setThumbnails(prev => ({ ...prev, ...newThumbnails }));
    }

    if (toGenerate.length > 0 && ildaParserWorker) {
      toGenerate.forEach(filePath => {
        if (!requestedThumbnailsRef.current.has(filePath)) {
          requestedThumbnailsRef.current.add(filePath);
          processingQueueRef.current.push(filePath);
          setLoadingThumbnails(prev => new Set(prev).add(filePath));
        }
      });
      if (!isProcessingRef.current) {
        processNextInQueue();
      }
    }
  }, [ildaParserWorker, loadCachedThumbnail, processNextInQueue]);

  useEffect(() => {
    if (viewMode === 'thumbnails' && ildFiles.length > 0) {
      loadThumbnailsForFiles(ildFiles);
    }
  }, [viewMode, ildFiles, loadThumbnailsForFiles]);

  useEffect(() => {
    const loadDefaultDir = async () => {
      if (path) {
        const files = await window.electronAPI.readIldFiles(path);
        setIldFiles(files);
        requestedThumbnailsRef.current.clear();
        processingQueueRef.current = [];
        isProcessingRef.current = false;
        setThumbnails({});
        setLoadingThumbnails(new Set());
        fileStatsCacheRef.current = {};
        return;
      }

      if (window.electronAPI && window.electronAPI.getUserIldaPath) {
        const defaultDir = await window.electronAPI.getUserIldaPath();
        if (defaultDir) {
          setSelectedDirectory(defaultDir);
          const files = await window.electronAPI.readIldFiles(defaultDir);
          setIldFiles(files);
          requestedThumbnailsRef.current.clear();
          processingQueueRef.current = [];
          isProcessingRef.current = false;
          setThumbnails({});
          setLoadingThumbnails(new Set());
          fileStatsCacheRef.current = {};
        }
      }
    };
    loadDefaultDir();
  }, [path]);

  const handleOpenExplorer = async () => {
    if (window.electronAPI) {
      const directoryPath = await window.electronAPI.openFileExplorer();
      if (directoryPath) {
        setSelectedDirectory(directoryPath);
        const files = await window.electronAPI.readIldFiles(directoryPath);
        setIldFiles(files);
        requestedThumbnailsRef.current.clear();
        processingQueueRef.current = [];
        isProcessingRef.current = false;
        setThumbnails({});
        setLoadingThumbnails(new Set());
        fileStatsCacheRef.current = {};
      }
    }
  };

  return (
    <div className="file-browser">
      <button onClick={handleOpenExplorer}>Open Folder</button>
      <div className="list_switcher">
        <button className={viewMode === 'list' ? 'active' : ''} onClick={() => onViewModeChange && onViewModeChange('list')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" fill="currentColor" className="bi bi-list" viewBox="0 0 16 16">
            <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"/>
          </svg>
        </button>
        <button className={viewMode === 'thumbnails' ? 'active' : ''} onClick={() => onViewModeChange && onViewModeChange('thumbnails')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" fill="currentColor" className="bi bi-image" viewBox="0 0 16 16">
            <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>
            <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/>
          </svg>
        </button>
      </div>
      {selectedDirectory && <p className="fileBrowser">
        Selected Directory: {selectedDirectory.split(/[/\\]/).filter(Boolean).pop()}
        </p>
      }
      <div className="ild-file-grid" style= {{display: viewMode === 'thumbnails' ? null : 'none'}}>
        {ildFiles.filter(f => !invalidFiles.has(f)).length > 0 ? (
          ildFiles.filter(f => !invalidFiles.has(f)).map((filePath, index) => {
            const fileName = filePath.split(/[/\\]/).pop();
            const data = thumbnails[filePath];
            const isLoading = loadingThumbnails.has(filePath);
            return (
              <div
                key={filePath}
                className="ild-file-preview"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ filePath, fileName }))}
              >
                <div className="file_thumbnail">
                    {data ? (
                        <StaticIldaThumbnail 
                            bitmap={data instanceof ImageBitmap ? data : null} 
                            frame={data instanceof ImageBitmap ? null : data} 
                        />
                    ) : isLoading ? (
                        <div className="clip-loading-spinner"></div>
                    ) : (
                        <div className="file-thumbnail-placeholder">No Preview</div>
                    )}
                </div>
                <div className="file_name">{fileName}</div>
              </div>
            );
          })
        ) : (
          <p>No valid ILD files found in selected directory.</p>
        )}
      </div>
      <div className="ild-file-list" style= {{display: viewMode === 'list' ? null : 'none'}}>
        {ildFiles.filter(f => !invalidFiles.has(f)).length > 0 ? (
          ildFiles.filter(f => !invalidFiles.has(f)).map((filePath, index) => {
            const fileName = filePath.split(/[/\\]/).pop();
            return (
              <div
                key={filePath}
                className="ild-file-item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ filePath, fileName }))}
              >
                {fileName}
              </div>
            );
          })
        ) : (
          <p>No valid ILD files found in selected directory.</p>
        )}
      </div>
    </div>
  );
};

export default FileBrowser;