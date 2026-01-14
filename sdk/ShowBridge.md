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