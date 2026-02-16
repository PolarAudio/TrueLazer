# Implementation Plan: NDI Optimization

## Phase 1: Analysis and Benchmarking
- [ ] Task: Baseline Performance Measurement
    - [ ] Write performance tests to measure current CPU/latency.
    - [ ] Implement telemetry for frame-to-laser latency.
- [ ] Task: Profile Native Wrapper
    - [ ] Run profiler on `ndi_wrapper.node`.
    - [ ] Identify hot paths in frame capture and conversion.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Analysis and Benchmarking' (Protocol in workflow.md)

## Phase 2: Native Wrapper Optimization
- [ ] Task: Implement Asynchronous Capture
    - [ ] Write tests for async frame capture logic.
    - [ ] Update `ndi_wrapper.cc` to use background threads for NDI capture.
- [ ] Task: Optimize Buffer Transfers
    - [ ] Write tests for memory-efficient buffer sharing.
    - [ ] Implement SharedArrayBuffer or direct memory access for frame data.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Native Wrapper Optimization' (Protocol in workflow.md)

## Phase 3: Renderer Integration
- [ ] Task: Optimize React Frame Handling
    - [ ] Write tests for efficient frame processing in the renderer.
    - [ ] Reduce re-renders and use optimized workers for NDI-to-points conversion.
- [ ] Task: Final Stabilization
    - [ ] Write integration tests for long-running NDI streams.
    - [ ] Fine-tune buffer sizes and jitter correction.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Renderer Integration' (Protocol in workflow.md)
