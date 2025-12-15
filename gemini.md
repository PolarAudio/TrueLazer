General Project Idea

A Laser Show Program that works like Resolume,
Resolume is a powerful VJ software for live video mixing and effects. It's known for its intuitive and
  customizable interface. Here's a breakdown of its UI and core features compared to other software:

  User Interface


   * Deck-based Layout: The central "deck" is a grid where you organize your media clips. This is a common
     paradigm in VJ software, but Resolume's implementation is very flexible.
   * Layers and Columns: You can stack visuals in layers and organize your performance into columns, which is
     great for structuring a show.
   * Customizable Panels: The entire interface is made of panels that you can rearrange, resize, and hide.
     This level of customization allows you to create a workspace that's perfectly tailored to your workflow,
     which is a significant advantage over more rigid interfaces.
   * Integrated Browser: A built-in browser lets you easily access and manage your media, effects, and
     sources.

  Core Features


   * Live Video Mixing: Play and mix multiple video and audio files in real-time, with control over playback
     speed and direction.
   * Extensive Effects Library: Resolume comes with over 100 built-in video effects and allows you to create
     your own using Resolume Wire, a node-based patching environment. This is a major advantage, as it offers
     limitless creative possibilities.
   * Generative Content (Sources): Besides playing video files, Resolume can generate visuals on the fly. This
      includes simple colors and text, as well as more complex generative content. This is a powerful feature
     for creating unique and dynamic visuals.
   * Audio-Visual Integration: It can sync visuals to the beat of the music through audio analysis.
   * Projection Mapping (Arena): The Arena version of Resolume has advanced tools for projection mapping,
     allowing you to map visuals onto complex surfaces. This is a high-end feature that sets it apart from
     more basic VJ software.
   * Extensive Control Options: It can be controlled with MIDI, OSC, DMX, and SMPTE timecode, allowing for
     seamless integration with other show control systems.


  In comparison to other software, Resolume's strengths lie in its combination of a user-friendly,
  customizable interface with a powerful and extensible feature set. While other VJ software might offer
  similar features, Resolume's node-based environment for creating custom effects and generators (Wire) and
  its advanced projection mapping capabilities (Arena) make it a top choice for professionals.
  
TrueLazer will be the Name of our Project and we use JavaSricpt as Core language to get the most versitile language possible.

  
Our Goal is to code a Program that works like Resolume But for Laser/ILDA usage.
We use Showbridge as our DAC so we have to learn from the Truewave SDK folder how our Software send the ILDA data to the showbridge DAC/Interface.
MIDI and DMX/Artnet integration is very important and should work in the end by activate the midi or DMX learn mode and learn each button or slider to the midi/DMX command it recieve. 
We Use mostly Artnet/shownet for our DMX mapping so we need everything to achieve that functions.

A list of things we change inside of the UI:
	
  User Interface

   * Deck-based Layout: The central "deck" is a grid where you organize your ilda clips.
   * Layers and Columns: You can stack clips in layers and organize your clips into columns.
   * Customizable Panels: The entire interface is made of panels that you can rearrange, resize, and hide.
     This level of customization allows you to create a workspace that's perfectly tailored to your workflow,
     which is a significant advantage over more rigid interfaces.
   * Integrated Browser: A built-in browser lets you easily access and manage your media, effects, and
     sources.

  Core Features

   * Live ILDA Mixing: Play and mix multiple ILDA and audio files in real-time, with control over playback
     speed and direction.
   * Extensive Effects Library: built-in effects (like Rotation,Scale,Transform etc.) allows us to create or manipulate Sources by draging them on a ILDA CLIP
	 If Possible for us we can create a Node Based effect window that opens if we want to customize effects. Like the resolume Wire Example(This is a visual, node-based programming environment that comes with Resolume. It allows
     you to create your own effects, sources, and mixers without writing traditional code. You connect nodes
     together to build your logic.)
	 We create some premade effects but leave the option to create own effects and save them.
   * Generative Content (Sources): Besides playing ILDA files, We want to generate ILDA on the fly. This
      includes simple colors, dots, lines, circles and text, as well as more complex generative content.
   * Audio-Visual Integration: We want to sync Clips to the beat of the music through audio analysis.
   * Projection Mapping : We need to edit Outputs for each laser projector like ip-adress, size, safe-zones if possible some option to adjust warping would be also great.
   * Extensive Control Options: It can be controlled with MIDI, OSC, DMX, allowing for
     seamless integration with other show control systems.
	 
Our *original* ShowBridge protocol follows this pattern (this section describes the native ShowBridge protocol, not the new IDN integration):
	Broadcast Message to 255.255.255.255:8089 with
    Command: 6 bytes = Target IP (169.254.25.104) + Flags (163, 31).
	
	Answer from DAC to "Target IP":8099
    Response: 16 bytes = Vendor ID (22,26) + Type (1) + Channel (1/2) + Device ID (630380)

	16 1a 01 01 00 20 00 25 00 00 00 00 00 00 00 00    	ip 25.69  ch 1
	16 1a 01 01 00 26 00 3f 00 00 00 00 00 00 00 00 	ip 25.104 ch 1
	16 1a 01 02 00 20 00 25 00 00 00 00 00 00 00 00 	ip 25.69  ch 2
	16 1a 01 02 00 26 00 3f 00 00 00 00 00 00 00 00   	ip 25.104 ch 2

The labels 7 and 8 are extracted from the checksum’s last nibble, matching the device’s channel identifiers.

The Documentation for how we work and understand ILDA Files is at sdk/ILDA_IDTF14_rev011.pdf
It is important to scan the first 4 bytes to = ILDA if the .ild file does not have ILDA in the first 4 bytes we ignore it,
next byte 7 is our format byte where we expect 0,1,2,4,5 as valid formats.

## Key Principles
*   **Readability:** Code should be easy to understand for all team members.
*   **Maintainability:** Code should be easy to modify and extend.
*   **Consistency:** Adhering to a consistent style across all projects improves collaboration and reduces errors.

## Project-Specific Instructions
*   **Logging:** Use the project's custom logging library (e.g., `Logger::logInfo()`, `Logger::logError()`) instead of `std::cout` for application-level logging.
*   **Performance Considerations:** Pay attention to performance-critical sections of code, especially in the data processing pipeline. Profile and optimize as needed.

## Persona and Tone
*   Act as a helpful and knowledgeable JS expert, providing clear explanations and efficient solutions.
*   Prioritize code quality, maintainability, and adherence to modern JS principles.
*   When suggesting refactorings, explain the rationale behind the changes.

** We Always work on one feature at a time and write a Detailed summary of every Feature we created once its working **
** Before Deleting Code we check if other Features rely on that Code **


## Project Summary

**Project Name:** TrueLazer

**Core Language:** JavaSricpt

**Goal:** Create a laser show program similar to Resolume for ILDA control.

**DAC:** Showbridge

**Folder Structure** 
	|___TrueLazer_js
		|	
		|___sdk (Information about devices,software,documents)
		|	|___dac(In this Folder we have a Example for the Etherdream DAC that we include in the future)
New		|	|___IDN-Laser-Tester-master-speed-slider
New		|	|___IDN-Stream-Driver_discrete-mode_PUBLIC-main
New		|	|___OpenIDN-Laser-DAC-Framework-main
New		|	|___idn-toolbox-master
		|
		|___src (Our Source Folder)
			|___ILDA-FILE-FORMAT-FILES (In Here we have our default ILD Files)
			|_trueLazer.ico(our Icon Image)


**Connectivity:**

*   The application will make use of the openIDN framework for dac discovery and frame-sending.
*   The UI displays a list of discovered DACs from openIDN and their channels/names in real-time starting with the first Channel.
*   The user can select a DAC and channel from the list.
*   The SDK is initialized on-demand when communication is required (e.g., sending frames, getting show info), preventing crashes on device selection.

**Titlebar**
	
*	The title bar  will be containing all the settings bellow:
*	The TrueLazer Button at the top left Contains Information like About, version number, Github link etc.
*	The Settings will be a Placeholder until we decide what settings we need to be changeable by a user.
*	The Layer Button Contains (get active Selected layer) New,Insert Above,Insert Below,Rename,Clear Clips, trigger Style (Aplie to all clips in that layer). same for the right click menu for each layer.
*	The Column Button Contains (get Active Selected Column) New,Insert befor,Insert After, Duplicate, Rename, Clear Clips, remove. Same for the Right Click menu on columns.
*	The Clip button Contains (get Active Selected Clip) Trigger Style, Thumbnail, Cut, Copy, Paste, Rename, Clear. Same for the Right click menu on each clip.
*	The Output Button will open a new window in the future where we adjust output settings for our projectors. Like Scan Speed, Size, Mirroring, safe-zones and warping.
*	The Shortcuts button will Open a list of input options : DMX/Artnet, MIDI And OSC if we click on on of them it starts the recording/mapping mode 
*	The View button will let us choose of predefined layouts and color theme and render mode (High or Low performance mode to switch between 2d and 3d Rendering preview)
*	If dragging a dac with 2 channels to a clip or layer we apply that output to booth channels.
*   Build an initial framework for DAC communication using the IDN protocol, including discovery and basic frame sending capabilities.
*   The application can now discover DACs using the IDN protocol.
*   It is able to send basic frames to discovered IDN DACs.

** Done **

*	Building the application as executable with our icon src/trueLazer.ico
*	Start to save application settings into temp storage and acces them on restarting the application.
	(Loaded Clips,Render-settings,theme-color,slider-value,dac-assignment,last-opened-project.)
*	Create a default folder path to save projects. like c:user/documents/truLazer/projects or C:User/Programm Files/TruLazer/..

*		 "Save project"	Developing the save project system for users to save there project.
			(In Developement)

**Next Steps:**

*   Implement sending of real-time messages using `idn-communication.js`.

*   Integrate NDI 5&6 by either grandiose or NDI SDK, Syphon, and Spout  streaming
	

	
## IDN Integration Details
(NEW SECTION)
	

	
*   **`idn-communication.js`:** This new utility module handles the low-level IDN protocol communication, including:
	
    *   **DAC Discovery:** Sends UDP broadcast scan requests (`IDNCMD_SCAN_REQUEST`) and parses responses (`IDNCMD_SCAN_RESPONSE`) to identify available IDN DACs on the network.
	
    *   **Frame Sending:** Constructs and sends IDN-compliant real-time channel messages (`IDNCMD_RT_CNLMSG`) containing ILDA frame data (XYRGB points) to specific DACs and channels.
	
    *   **Channel Closing:** Sends `IDNCMD_RT_CNLMSG_CLOSE` to gracefully terminate a channel session.
	
*   **`dac-communication.js`:** This module now acts as an abstraction layer for DAC communication. It utilizes `idn-communication.js` for IDN-specific tasks.
	
    *   The `discoverDacs` function in `dac-communication.js` now calls `idn-communication.js`'s `discoverDacs` and formats the results for the application.
	
    *   The `sendFrame` function similarly calls `idn-communication.js`'s `sendFrame`.
	
    *   The `stopSending` function uses `idn-communication.js`'s `sendCloseChannel` to close IDN channels.
	
*   **Testing with `idn-toolbox-master`:** The `idn-toolbox-master` application (specifically `idn-toolbox.exe` for Windows) serves as a valuable tool for testing our IDN implementation. It allows us to simulate IDN devices and verify that our application can discover them and send frames correctly. This helps in understanding the IDN protocol interactions in a real-world scenario.
