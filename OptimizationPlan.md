	📋 Optimization Plan (Priority Order)

     Phase 1 — Immediate Wins (Low Risk, High Impact)

     1.1. Add useTransition to blocking dispatches

     - Wrap heavy dispatches (SET_CLIP_CONTENT, ADD_CLIP_EFFECT, UPDATE_GENERATOR_PARAM, etc.) in startTransition
     - Keeps UI responsive during parameter changes
     - Location: src/App.jsx — all event handlers that dispatch state updates

     1.2. Add useDeferredValue for clip grid rendering

     - Defer the clipContents value passed to the 40 Clip components
     - The grid can render stale data briefly while the input (e.g., slider) stays smooth
     - Location: Wrap clipContents in useDeferredValue before passing to the grid render loop

     1.3. Fix SidePanelContainer 70fps tick re-render waste

     - Current: setTick(t => t + 1) at 70fps inside SidePanelContainer
     - The worldFrames useMemo depends on [tick, liveFramesRef] — but liveFramesRef is stable
     - Instead: only tick when liveFramesRef.current actually changes (check via shallow comparison or a separate counter ref that increments only on new frames)
     - This will eliminate ~60 unnecessary re-renders per second of IldaPlayer + WorldPreview

     1.4. Memoize LayerControls and ColumnHeader grid items

     - LayerControls is already React.memo but the inline render in App's return creates new activeClipDataForLayer, liveFrameForLayer objects every render
     - Create these outside the JSX or use useMemo for the mapping
     - Similarly for the 40 Clip components: clipLiveFrame = liveFramesRef.current[clipWorkerId] is a new ref on every render — wrap in useMemo keyed by workerId


     Phase 2 — Structural Refactoring (Medium Risk, High Impact)

     2.1. Extract heavy UI sections with React.lazy + Suspense
     - ShapeBuilder.jsx (3385 lines): loaded on demand
     - TimelineEditor.jsx: loaded on demand
     - OutputSettingsWindow.jsx (557 lines), AudioSettingsWindow.jsx (266 lines)
     - Location: src/App.jsx imports → React.lazy(() => import(...))
     - Bundle size reduction: ~35% of component code deferred
	 
     2.2. Split the monolithic reducer into domain slices
     - Extract reducers by domain: clipReducer, layerReducer, dacReducer, uiReducer, playbackReducer
     - Each slice manages its own portion of state using the "reducer composition" pattern (like Redux)
     - Then compose them in a top-level rootReducer
     - Location: New files under src/reducers/
     - Benefit: isolated state updates don't cause unrelated memoized values to recalculate

     2.3. Extract the clip grid into a separate ClipGrid component

     - Move the nested loops rendering 40 Clip components + 8 ColumnHeaders + 5 LayerControls into a dedicated component
     - React.memo the entire grid with proper prop comparison
     - The grid receives only the data it needs, not the entire App state
     - Location: New file src/components/ClipGrid.jsx

     2.4. Extract the bottom panel into a BottomPanel component

     - Move FileBrowser, GeneratorPanel, EffectPanel, ClipSettingsPanel, LayerSettingsPanel, DacPanel, SettingsPanel into one memo'd component
     - Avoids re-rendering all panels when only the top bar changes


     Phase 3 — Advanced Performance (Higher Risk, High Impact)

     3.1. Replace the monolithic useReducer with Zustand or Jotai

     - Benefit: atomic subscriptions — components only re-render when their specific slice of state changes
     - No more destructuring-and-recreating-all-variables pattern
     - No more useEffect → ref sync pattern (stores can expose refs directly)
     - Migration path: start with Zustand, keep the reducer actions as Zustand store actions
     - Location: Replace useReducer in src/App.jsx:1740

     3.2. Implement useSyncExternalStore for the tick-based animation loop

     - Currently SidePanelContainer uses useState(0) + setTick in rAF loop
     - Replace with a subscription-based pattern that only notifies when a new frame ID changes
     - Reduces re-render waste when frames haven't actually updated

     3.3. Web Worker for effect processing                                                                                                                                                                                                                      

     - Currently applyEffects runs in the main thread during the animate loop
     - Move per-clip effect application into a Web Worker
     - Location: src/App.jsx:2318+ (DAC processing loop) and SidePanelContainer preview rendering

     3.4. requestAnimationFrame batching for dispatches

     - Instead of calling dispatch() directly in event handlers, batch multiple dispatches into a single rAF callback
     - Prevents React from doing 10+ renders per user interaction (e.g., dragging a slider)
     - The throttle utility already does this partially but it's not rAF-aligned


     Phase 4 — CSS & Rendering Pipeline

     4.1. CSS module splitting

     - Split src/index.css (2273 lines) into component-specific CSS modules
     - Use Vite's CSS module support
     - Only relevant CSS is loaded per component

     4.2. LayerControls anti-pattern fix

     - Current: const [appliedEffects, setAppliedEffects] = useState(layerEffects || []) + useEffect to sync
     - Remove internal state, use prop directly — or if local mutations are needed, use useRef + useMemo
     - Location: src/components/LayerControls.jsx:8-14

     4.3. Thumbnail scan optimization

     - Current: iterates for (let p = 0; p < 8; p++) for (let i = 0; i < 5; i++) for (let j = 0; j < 8; j++) on every thumbnail change
     - Track only changed thumbnails via a Set/map instead of scanning all 320 slots
     - Location: src/App.jsx:3240-3276


     ⚡  Expected Performance Gains

     |Recomandation                                                                │Estimated Performance Improvement
     ├─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────
     │useTransition + useDeferredValue                                             │3-5x perceived responsiveness
     ├─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────
     │SidePanelContainer tick fix                                                  │Eliminates ~60 re-renders/sec│
     ├─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────
     │Zustand/Jotai migration                                                      │10x fewer component re-renders on state changes
     ├─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────
     │Lazy loading heavy components                                                │35% reduction in initial bundle
     ├─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────
     │ClipGrid extraction                                                          │Isolates 40+ component re-renders
     ├─────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────
     │Reducer splitting                                                            │Localizes state update cost
     └─────────────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────

     🛑 Anti-Patterns to Fix (Quick Wins)

     1. LayerControls.jsx:8 — useState + useEffect sync → use prop directly
     2. SidePanelContainer 70fps tick → only tick when frame data changes
     3. All the useEffect ref syncs (lines 1924-2015) → if you switch to Zustand, these disappear entirely
     4. The "create new object every render" pattern in the clip grid inline loops → extract and memoize
