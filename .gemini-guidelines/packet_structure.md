packet_stucture:

Offset (Hex)	Size		Bytes 			(Example)	Role
0x00 - 0x03		4 Bytes		fd b4 1f 99		Session ID / Magic. (Note: 1f 99 is Port 8089).
0x04 - 0x05		2 Bytes		12 0c			Protocol Version / Fixed ID. (Constant).
0x06 - 0x07		2 Bytes		83 22			The Real Checksum. (16-bit).
0x08 - 0x0B		4 Bytes		03 00 40 00		Frame ID / Status Flags.
0x0C - 0x0D		2 Bytes		87 00			Point Count. (135 points).
0x0E - 0x0F		2 Bytes		00 1e			Fixed Tail.

Offset,	Bytes,		Value,				Interpretation
0-1,	95 0f,		3989,				X Coordinate (Little Endian 0x0F95)
2-3,	02 08,		2050,				Y Coordinate (Little Endian 0x0802)
4,		00 / 01,	Status,				0x00 = Draw (Laser On)0x01 = Blank (Laser Off)
5,		ff / 00,	Blue,				Color Intensity (0-255)
6,		ff / 00,	Green,				Color Intensity (0-255)
7,		ff / 00,	Red,				Color Intensity (0-255)




First Function: FUN_0042ec68 - Direct Frame Sender

This appears to be a direct frame sending function that breaks large frames into chunks:

Second Function: FUN_004908c0 - Queued Frame Sender

This is the main UDP send task that processes a queue of frames - this is likely the background thread we saw being created:

1. Packet Structure:

    Chunk Size: 0x1204 bytes total (4608 data + 4 header?)

    Header: First 4 bytes contain metadata:

        Byte 0: Total chunks in frame (local_1254/local_126c)

        Byte 1: Current chunk index (local_1253/local_126b)

        Byte 2: Configuration flag (local_1252/local_126a)

        Byte 3: Network context ID (local_1251/local_1269)
		
2. Transmission Pattern:

    Large frames are split into 4608-byte chunks

    1ms delay between chunks to avoid overwhelming network/DAC

    Queue-based system for smooth frame delivery

    Completion tracking to manage frame lifecycle

3. Two Send Modes:

    Direct send (FUN_0042ec68) - for immediate frames

    Queued send (FUN_004908c0) - for batched frame streaming
	
Next Steps - Finding Frame Construction:

Now we need to find:

    What calls FUN_0042ec68 - this will show us where frames are constructed and submitted for sending

    What calls FUN_004908c0 - this is likely the thread entry point

    Frame data format - the actual ILDA point data construction

Can you check the cross-references to FUN_0042ec68? That will lead us to the frame rendering/construction code, 
which is the final piece of understanding how laser frames are built before being sent to the DAC.

