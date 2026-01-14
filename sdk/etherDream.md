**Ether Dream - Protocol**

*Introduction*

This protocol documentation applies to all versions of the Ether Dream. 
Newer versions have a larger buffer size but otherwise implement the same protocol.

Communication with the DAC happens over TCP on port 7765. 
The DAC will only communicate with one host at a time; 
another device that connects while the DAC has an established control connection will have its connection attempt rejected.

The DAC has a USB interface as well. This is used only for firmware updates. 
The original Ether Dream 1 implements firmware updates via DFU, while later versions use a standard USB Mass Storage Class interface.

In this document, protocol messages are described as structs. 
Fields are packed together with no padding (__attribute__((packed)) or #pragma pack(1)); 
standard C typedefs such as uint8_t, uint32_t, int32_t, etc. have their usual meanings, 
and multi-byte values are transmitted little-endian ("host" byte order on x86 and ARM): the most significant byte appears first.

State Machines

There are three distinct state machines within the DAC: light engine, playback, and source. The light engine states are:

    0: Ready.
    1: Warmup. In the case where the DAC is also used for thermal control of laser apparatus, this is the state that is entered after power-up.
    2: Cooldown. Lasers are off but thermal control is still active.
    3: Emergency stop. An emergency stop has been triggered, either by an E-stop input on the DAC, an E-stop command over the network, or a fault such as over-temperature.

The light engine state machine is for future use cases where the Ether Dream is built in to a projector. The "warmup" and "cooldown" states are not currently used.

The DAC has one playback system, which buffers data and sends it to the analog output hardware at its current point rate. 
At any given time, the playback system is connected to a source. 
Usually, the source is the network streamer, which uses the protocol described in this document; 
however, other sources exist, such as a built-in abstract generator and file playback from SD card. 
The playback system is in one of the following states:

    0: Idle. This is the default state. No points may be added to the buffer. No output is generated; all analog outputs are at 0v, and the shutter is controlled by the data source.
    1: Prepared. The buffer will accept points. The output is the same as in the Idle state.
    2: Playing. Points are being sent to the output.

*Status Responses*

Periodically, and as part of ACK packets, the DAC sends to the host information on its current playback status. The status struct is:

    struct dac_status {
            uint8_t protocol;
            uint8_t light_engine_state;
            uint8_t playback_state;
            uint8_t source;
            uint16_t light_engine_flags;
            uint16_t playback_flags;
            uint16_t source_flags;
            uint16_t buffer_fullness;
    	uint32_t point_rate;
    	uint32_t point_count;
    };

The light_engine_state field gives the current state of the light engine. If the light engine is Ready, light_engine_flags will be 0. 
Otherwise, bits in light_engine_flags will be set as follows:

    [0]: Emergency stop occurred due to E-Stop packet or invalid command.
    [1]: Emergency stop occurred due to E-Stop input to projector.
    [2]: Emergency stop input to projector is currently active.
    [3]: Emergency stop occurred due to overtemperature condition.
    [4]: Overtemperature condition is currently active.
    [5]: Emergency stop occurred due to loss of Ethernet link.
    [15:5]: Future use. 

Similarly, playback_state gives the state of the playback system. The playback_flags field may be nonzero during normal operation. 
Its bits are defined as follows:

    [0]: Shutter state: 0 = closed, 1 = open.
    [1]: Underflow. 1 if the last stream ended with underflow, rather than a Stop command. Reset to zero by the Prepare command.
    [2]: E-Stop. 1 if the last stream ended because the E-Stop state was entered. Reset to zero by the Prepare command. 

The buffer_fullness field contains the number of points currently buffered. 
point_rate is the number of points per second for which the DAC is configured (if Prepared or Playing), or zero if the DAC is idle. 
point_count is the number of points that the DAC has actually emitted since it started playing (if Playing), or zero (if Prepared or Idle).

The currently-selected data source is specified in the source field:

    0: Network streaming (the protocol defined in the rest of this document).
    1: ILDA playback from SD card.
    2: Internal abstract generator. 

*Broadcast*

Regardless of the data source being used, each DAC broadcasts a status/ID datagram over UDP to its local network's broadcast address once per second. 
This datagram is formed as follows:

    struct j4cDAC_broadcast {
    	uint8_t mac_address[6];
    	uint16_t hw_revision;
    	uint16_t sw_revision;
    	uint16_t buffer_capacity;
    	uint32_t max_point_rate;
            struct dac_status status;
    };

*Commands*

When a host first connects to the device, the device immediately sends it a status reply, as if the host had sent a ping packet (described later). 
The host sends to the device a series of commands. 
All commands receive a response from the DAC; responses are described after the list of commands. 
The commands are as follows:

Prepare Stream

Single byte: 'p' (0x70)

This command causes the playback system to enter the Prepared state. 
The DAC resets its buffer to be empty and sets "point_count" to 0. 
This command may only be sent if the light engine is Ready and the playback system is Idle. 
If so, the DAC replies with ACK; otherwise, it replies with NAK - Invalid.

Begin Playback

    struct begin_command {
    	uint8_t command; /* 'b' (0x62) */
            uint16_t low_water_mark;
    	uint32_t point_rate;
    };

This causes the DAC to begin producing output. 
point_rate is the number of points per second to be read from the buffer. 
If the playback system was Prepared and there was data in the buffer, then the DAC will reply with ACK; otherwise, it replies with NAK - Invalid.

TODO: The low_water_mark parameter is currently unused.
Queue Rate Change

    struct queue_change_command {
    	uint8_t command; /* 'q' (0x74) */
    	uint32_t point_rate;
    };

This adds a new point rate to the point rate buffer. 
Point rate changes are read out of the buffer when a point with an appropriate flag is played; see the Write Data command. 
If the DAC is not Prepared or Playing, it replies with NAK - Invalid. 
If the point rate buffer is full, it replies with NAK - Full. Otherwise, it replies with ACK.

Write Data

    struct data_command {
    	uint8_t command; /* ‘d’ (0x64) */
    	uint16_t npoints;
    	struct dac_point data[];
    };
    struct dac_point {
            uint16_t control;
            int16_t x;
            int16_t y;
    	uint16_t r;
    	uint16_t g;
    	uint16_t b;
    	uint16_t i;
    	uint16_t u1;
    	uint16_t u2;
    };

This provides data for the DAC to add to its buffer. The data values are full-scale (for instance, for color channels, 65535 is full output); the least-significant bits of each word will be ignored if the DAC’s resolution is less than 16 bits. The DAC will reply with ACK if the incoming packet can fully fit in its buffer, or NAK - Full if it cannot. It is valid for npoints to be zero; in this case, no point will be added to the buffer, but the packet will still be ACKed (as long as the DAC is Prepared or Playing.)

The "control" field has the following fields defined:

    [15]: Change point rate. If this bit is set, and there are any values in the point rate change buffer, then a new rate is read out of the buffer and set as the current playback rate. If the buffer is empty, the point rate is not changed.
    Other bits: reserved for future expansion to support extra TTL outputs, etc. 

*Stop*

Single byte: 's' (0x73)

The stop command causes the DAC to immediately stop playing and return to the Idle state. It is ACKed if the DAC was Playing or Prepared; otherwise it is replied to with NAK - Invalid.
Emergency Stop

Single byte: 0x00 or 0xFF. (The DAC will recognize either one.)

The e-stop command causes the light engine to enter the E-Stop state, regardless of its previous state. It is always ACKed.

Any unrecognized command will also be trested as E-stop; however, software should not send undefined commands deliberately, since they may be defined in the future.
Clear E-Stop

Single byte: 'c' (0x63)

If the light engine was in E-Stop state due to an emergency stop command (either from a local stop condition or over the network), then this command resets it to be Ready. It is ACKed if the DAC was previously in E-Stop; otherwise it is replied to with a NAK - Invalid. If the condition that caused the emergency stop is still active (E-Stop input still asserted, temperature still out of bounds, etc.), then a NAK - Stop Condition is sent.
Ping

Single byte: '?' (0x3F)

The DAC will reply to this with an ACK packet. This serves as a keep-alive for the connection when the DAC is not actively streaming.
Responses

Responses have one form:

    struct dac_response {
    	uint8_t response;
    	uint8_t command;
    	struct status dac_status;
    };

In the case of ACK/NAK responses, "command" echoes back the command to which the response is sent. (Commands are always sent in order, so this field exists for sanity-checking on the host side.) The response field can be one of the following:

    ACK - 'a' (0x61) - The previous command was accepted.
    NAK - Full - 'F' (0x46) - The write command could not be performed because there was not enough buffer space when it was received.
    NAK - Invalid - 'I' (0x49) - The command contained an invalid command byte or parameters.
    NAK - Stop Condition - '!' (0x21) - An emergency-stop condition still exists. 

