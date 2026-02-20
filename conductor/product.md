# Product Definition: TrueLazer

## Initial Concept
TrueLazer is an ambitious source-available project aiming to create a powerful and flexible laser show control software, drawing inspiration from the intuitive workflow and extensive features of Resolume Arena. Built with JavaScript, TrueLazer is designed to provide artists and technicians with a versatile tool for live ILDA mixing, generative content, and advanced laser projection.

## Target Audience
The primary users are event technicians and lighting designers who are looking for a Resolume-like workflow for laser control. These users value familiarity, ease of use, and professional integration capabilities.

## Goals
The NDI integration has been successfully optimized and stabilized, providing high-performance real-time laser rendering with minimal CPU/GPU overhead. Our ongoing focus remains on professional stability and expanding the generative ecosystem.

## Core Features
- **Professional Integration:** High priority is placed on robust MIDI, OSC, and DMX/Artnet mapping. Includes a **Hybrid DMX System** with fixed personalities for rapid console setup (Master + 5 Layers) and custom modular patching for any effect parameter. High-frequency Art-Net traffic is handled via **Throttled IPC Delivery** (~33Hz) and full-universe change detection to ensure perfectly stable 60fps UI performance even under heavy DMX load. Features a real-time **16x32 DMX Monitor** for channel verification and network interface binding for dedicated control networks.
- **DAC Communication:** Seamless integration with IDN and EtherDream DACs for high-performance laser output. Includes **DAC Channel Grouping** for streamlined management of large multi-projector setups.
- **Resolume-Inspired UI:** A familiar deck-based layout with layers, columns, and **8 independent pages**, tailored for high-performance ILDA content management.
- **Integrated Preset System:** Save and manage favorite settings for every effect and generator, with full project portability ensuring presets travel with your .tlp files.
- **Generative & Effects System:** A robust library of shape generators (including equilateral triangles, real-time audio waveforms, and configurable timers) and advanced real-time effects (like offset/rotated mirroring and temporal frame delays). Advanced Shape Builder with intelligent auto-smooth Bezier curves, hybrid manual overrides, group transformations, and mode-aware timeline synchronization.

## Non-Functional Requirements
- **High Stability & Low Latency:** Essential for real-time laser rendering where timing is critical.
- **Low Resource Overhead:** The software must run smoothly on standard show laptops without excessive CPU or GPU strain.
- **Resilient Communication:** Ensuring rock-solid connectivity with DAC hardware to prevent any interruptions during live performances.
