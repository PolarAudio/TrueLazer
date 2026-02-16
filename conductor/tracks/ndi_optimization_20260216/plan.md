# Implementation Plan: NDI Optimization

## Phase 1: Analysis and Benchmarking
- [x] Task: Baseline Performance Measurement
    - [x] Write performance tests to measure current CPU/latency.
    - [x] Implement telemetry for frame-to-laser latency.
- [x] Task: Profile Native Wrapper
    - [x] Run profiler on `ndi_wrapper.node`.
    - [x] Identify hot paths in frame capture and conversion.
    - [x] Findings: Synchronous downsampling and Buffer::Copy are major bottlenecks.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Analysis and Benchmarking' (Protocol in workflow.md)

## Phase 2: Native Wrapper Optimization
- [x] Task: Implement Asynchronous Capture
    - [x] Update `ndi_wrapper.cc` to use background threads for NDI capture.
- [x] Task: Optimize Buffer Transfers
    - [x] Implement triple-buffering system in native wrapper.
    - [x] Offload downsampling to background thread.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Native Wrapper Optimization' (Protocol in workflow.md)

## Phase 3: Renderer Integration
- [x] Task: Optimize React Frame Handling
    - [x] Write tests for efficient frame processing in the renderer.
    - [x] Reduce re-renders and use optimized workers for NDI-to-points conversion.
- [x] Task: Final Stabilization
    - [x] Write integration tests for long-running NDI streams.
    - [x] Fine-tune buffer sizes and jitter correction.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Renderer Integration' (Protocol in workflow.md)
