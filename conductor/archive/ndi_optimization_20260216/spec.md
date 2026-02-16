# Specification: NDI Optimization and Stabilization

## Overview
Current NDI integration has a significant performance impact on the application. This track aims to optimize the NDI receiving and rendering pipeline to achieve smooth real-time laser output with minimal CPU/GPU overhead.

## Requirements
- Reduce CPU usage of the NDI native wrapper.
- Improve the efficiency of frame transfers between the native layer and the React renderer.
- Stabilize frame rates for NDI sources.
- Ensure low-latency rendering from NDI source to laser output.

## Technical Approach
- Profile the current `ndi_wrapper.cc` to identify bottlenecks.
- Explore asynchronous frame capturing in the native C++ wrapper.
- Optimize the data format for laser points to minimize conversion overhead.
- Implement efficient memory management for NDI buffers.
