  # TrueLazer

  ## Laser Show Software Inspired by Resolume

  TrueLazer is an ambitious open-source project aiming to create a powerful and flexible laser show control
  software, drawing inspiration from the intuitive workflow and extensive features of Resolume Arena. 
  Built with JavaScript, TrueLazer is designed to provide artists and technicians with a versatile tool for live
  ILDA mixing, generative content, and advanced laser projection.

  ## What Makes TrueLazer Special?

  While many software solutions exist for video mixing, TrueLazer carves its niche by focusing specifically on
   ILDA (International Laser Display Association) control with a user experience akin to industry-leading VJ
  software. Here's what sets us apart:

  Resolume-Inspired UI for ILDA:* We're building a familiar deck-based layout with layers and columns, but
  tailored for ILDA clips. This intuitive interface allows for dynamic organization and mixing of laser
  content in real-time.
  
  Showbridge DAC Integration:* Our core focus is seamless integration with Showbridge DACs, ensuring
  reliable and high-performance communication with your laser hardware.
  
  Generative ILDA Content:* Beyond playing pre-made ILDA files, TrueLazer will feature a robust generator
  system to create dynamic laser visuals on the fly, including basic shapes, text, and complex generative
  patterns.
     
  Extensive Effects Library:* Manipulate your laser content with a rich set of built-in effects (rotation,
  scale, transform, color palettes, blanking, etc.). 
  
  We envision a future with a node-based effect editor,
  similar to Resolume Wire, for limitless creative possibilities.
  Audio-Visual Integration:* Sync your laser shows to the beat of the music with advanced audio analysis
  capabilities.
  
  Comprehensive Control Options:* Designed for professional use, TrueLazer will support MIDI, OSC, and
  DMX/Artnet for seamless integration with existing show control systems and external hardware.
  
  JavaScript Core:* Leveraging JavaScript provides maximum versatility, allowing for a broad developer
  community and easy extensibility.

  ## Why Support TrueLazer?

  The laser show community often relies on proprietary software or complex custom solutions. TrueLazer aims to
   fill a critical gap by offering:

  An Open-Source Alternative:* Empowering artists and developers with a transparent, community-driven
  platform for laser control.
     Innovation:* By combining the best UI/UX practices from video mixing with dedicated laser control, we aim
   to push the boundaries of what's possible in live laser performances.
     Flexibility:* A modular design and JavaScript core mean TrueLazer can adapt to diverse needs and
  integrate with various hardware and software ecosystems.

  Your support, whether through contributions, feedback, or spreading the word, helps us build a powerful tool
   for the entire laser show community.

  creative minds should not be slowed down by a paywall.
  That is why we believe in this project  Open-Source and free for everyone.
  In the future, support for significantly more hardware will be added, either by us or by the community
  for now we focus on developing with the hardware we have on hand.

  ## Development Status

  TrueLazer is currently in its early development phase. We have established the foundational project
  structure and are actively working on the core UI components and defining the architecture for DAC
  communication and content management.
  
  ☐ - Not yet done
  
  ☒ - Partialy done
  
  ☑ - Finished
  
  Current Progress:
  
  ☑   Project scaffolding and basic file structure are in place.
  
  ☑   Initial UI components for the clip deck, layers, and controls are being designed and implemented.
  
  ☒   ILDA file parsing and rendering concepts are being explored. (need further Performance improvements)
  
  ☑   Showbridge DAC communication protocol has been analyzed.
  
  ## Next Steps

  Our immediate roadmap focuses on building out the core functionalities:

  1.  UI Development:
      
      ☒   Implement the full clip deck with layers, columns, and associated controls (Clear Clips, Blackout,
  Solo, Blend-mode, Intensity Sliders).
      
      ☒   Develop the Composition Label, Master Intensity Slider, and Laser On/Off Button.
      
      ☑   Create the "Selected Clip Preview" and "World Preview" windows.
      
      ☑   Integrate a file browser for ILDA files with drag-and-drop functionality.
      
      ☑   Implement dynamic layer and column management (edit/clear/rename).
      
      ☐   Develop custom title bar with menu options (TrueLazer Info, Settings, Layer, Column, Clip, Output,
  Shortcuts, View).

  2.  Generative Content System:
      ☐   Develop a simple set of shape generators (dots, lines, circles, text) as base layers.
      
  3.  Effects System:

      ☐   Implement core effects like transform (XYZ), rotation (XYZ), wave (XYZ), and color palette
  manipulation.

      ☐   Design the drag-and-drop mechanism for applying effects to clips and layers.
      
  4.  Control Integration:
     
      ☐   Begin integrating MIDI, DMX/Artnet, and OSC control via a "shortcuts" window.
      
  5.  DAC Communication:
     
      ☐   Implement the sending of ILDA frames to the selected Showbridge DAC and channel.
      
      ☐   Develop drag-and-drop functionality for assigning DAC channels to clips/layers.

  ## Contributing to TrueLazer

  We welcome contributions from developers, laser artists, and enthusiasts! Here's how you can get started:

  ### Prerequisites

  Before you begin, ensure you have the following installed:

     Node.js:* (LTS version recommended)
     npm (Node Package Manager) or Yarn*

  ### Getting Started

  1.  Clone the Repository:
      `
      git clone https://github.com/PolarAudio/TrueLazer.git
      cd TrueLazer
      `

  2.  Install Dependencies:
      `
      npm install
      `

  3.  Run the Development Server:
      TrueLazer uses Vite for a fast development experience.
      `
      npm start
      `
      This will start the development application with Console for debbuging.

  ### Project Structure Overview

  *   src/: Contains all the frontend source code, including React components, contexts, and utilities.
  *   sdk/: Houses information about DACs, software, and documentation, including the C++ SDK for Showbridge.
  *   src/ILDA-FILE-FORMAT-FILES/: A collection of default ILDA files for testing and development.

  ### How to Contribute

  1.  Fork the repository.
  2.  Create a new branch for your feature or bug fix: git checkout -b feature/your-feature-name or git
  checkout -b bugfix/issue-description.
  3.  Make your changes.
  4.  Commit your changes with a clear and concise message.
  5.  Push your branch to your forked repository.
  6.  Open a Pull Request to the main branch of the original TrueLazer repository, describing your changes in
  detail.

  We appreciate your help in making TrueLazer the ultimate open-source laser show software!
