# TrueLazer Art-Net DMX Mapping

This document defines the fixed DMX footprint for TrueLazer (Track 4 implementation). Use this data to create fixture profiles for lighting consoles like grandMA2, Hog, or Onyx.

## 1. Overview
- **Default Universe:** 0
- **Total Footprint:** 109 Channels
- **Addressing:** 1-indexed (Standard DMX)

---

## 2. Master Section (Channels 1-9)

| Channel | Parameter | DMX Range | Function |
| :--- | :--- | :--- | :--- |
| **1** | **Master Intensity** | 0 - 255 | Overall application brightness |
| **2** | **Global Blackout** | 0 - 127 <br> 128 - 255 | Blackout OFF <br> Blackout ON |
| **3** | **Page Select** | 0 - 31 <br> 32 - 63 <br> 64 - 95 <br> 96 - 127 <br> 128 - 159 <br> 160 - 191 <br> 192 - 223 <br> 224 - 255 
						  | Page 1 <br> Page 2  <br> Page 3  <br> Page 4   <br> Page 5    <br> Page 6    <br> Page 7    <br> Page 8 |
| **4** | **Transport** | 0 <br> 1 - 85 <br> 86 - 170 <br> 171 - 255 | No Action <br> Play <br> Pause <br> Stop |
| **5-9** | **Reserved** | - | Future Use | Dummy Cannel

---

## 3. Layer Section (20 Channels per Layer)

TrueLazer supports 5 layers. Each layer occupies a 20-channel block starting from Channel 11.

- **Layer 1:** Channels 10 - 29
- **Layer 2:** Channels 30 - 49
- **Layer 3:** Channels 50 - 69
- **Layer 4:** Channels 70 - 89
- **Layer 5:** Channels 90 - 109

### Layer Internal Mapping (Relative to Start)

| Offset 	| Channel 	| Parameter 			| DMX Range 	| Function 	|
| :---   	| :---    	| :--- 	   				| :--- 			| :--- 		|
| +0 		| **1** 	| **Layer Intensity** 	| 0 - 255 		| Individual Layer Opacity |
| +1 		| **2** 	| **Layer Controls** 	| 0 			| 1 - 64 		 	| 65 - 128 		 | 129 - 192 		 | 193 - 255 
												| No Action 	| Blackout Toggle 	| Solo Toggle 	 | Autopilot Forward | Autopilot OFF  |
| +2 		| **3** 	| **Clip Trigger** 		| 0 - 10 	  	| 11 - 20  	  		| 21 - 30 		 | 31 - 40 		  	 | 41 - 50 		  | 51 - 60 		| 61 - 70 		 | 71 - 80			| 81 - 90			| 91 - 255
												| Clear Layer 	| Trigger Clip 1 	| Trigger Clip 2 | Trigger Clip 3 	 | Trigger Clip 4 | Trigger Clip 5 	| Trigger Clip 6 | Trigger Clip 7	| Trigger Clip 8	| No Action
| +3 		| **4** 	| **Layer Speed** 		| 0 - 255 		| Playback speed for the active clip |
| +4 to +19 | **5-20** 	| **Reserved** 			| - 			| **Hybrid Area:** These channels are free for custom modular patching of effect or generator parameters via the "Learn" mode in TrueLazer. |

---

## 4. Setup Tips for MA2
1. **Fixture Type:** Create a "Server" fixture with 110 channels.
2. **Virtual Dimmer:** Map Channel 1 to `DIM` and Layer Channel 1 to `DIM` for each layer.
3. **Triggering:** Map Channel 13 (Layer 1 Clip Trigger) to a `CONTROL` or `GO` attribute with 10-unit steps.
4. **Binding:** Ensure TrueLazer is set to listen on the same Network Interface as your MA2 session (e.g., 192.168.x.x).
