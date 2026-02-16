# Product Definition: TrueLazer

## Initial Concept
TrueLazer is an ambitious source-available project aiming to create a powerful and flexible laser show control software, drawing inspiration from the intuitive workflow and extensive features of Resolume Arena. Built with JavaScript, TrueLazer is designed to provide artists and technicians with a versatile tool for live ILDA mixing, generative content, and advanced laser projection.

## Target Audience
The primary users are event technicians and lighting designers who are looking for a Resolume-like workflow for laser control. These users value familiarity, ease of use, and professional integration capabilities.

## Goals
The NDI integration has been successfully optimized and stabilized, providing high-performance real-time laser rendering with minimal CPU/GPU overhead. Our ongoing focus remains on professional stability and expanding the generative ecosystem.

## Core Features
- **Professional Integration:** High priority is placed on robust MIDI, OSC, and DMX/Artnet mapping. This allows users to control the software seamlessly using external hardware and existing show control systems.
- **Resolume-Inspired UI:** A familiar deck-based layout with layers and columns, tailored for ILDA content.
- **DAC Communication:** Seamless integration with IDN and EtherDream DACs for high-performance laser output.
- **Generative & Effects System:** A robust library of shape generators (including parametric triangles) and real-time effects. Advanced Shape Builder with intelligent auto-smooth Bezier curves, hybrid manual overrides, group transformations, and mode-aware timeline synchronization.

## Non-Functional Requirements
- **High Stability & Low Latency:** Essential for real-time laser rendering where timing is critical.
- **Low Resource Overhead:** The software must run smoothly on standard show laptops without excessive CPU or GPU strain.
- **Resilient Communication:** Ensuring rock-solid connectivity with DAC hardware to prevent any interruptions during live performances.
