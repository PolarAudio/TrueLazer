  Based on the analysis of the j4cDAC firmware (EtherDream), here are the details regarding the communication protocol:

  1. Packet Size
   * Point Data: 18 bytes per point.
       * Calculated from sizeof(dac_point) logic and standard EtherDream protocol.
       * Format: 9x 16-bit values (Control, X, Y, R, G, B, I, U1, U2).
   * TCP Packets: Variable length.
       * Command Header: 1 byte (Command Type).
       * Payload: Varies by command.
           * 'd' (Data): sizeof(struct data_command) + (npoints * 18).
           * 'b' (Begin): sizeof(struct begin_command) (Likely ~4-6 bytes: rate + low water mark).
   * UDP Broadcast: Fixed size struct dac_broadcast.
       * Contains MAC address (6 bytes), Status Struct (approx 16-20 bytes), Buffer Capacity, Max Rate, and Revisions.

  2. Packet Interval
   * UDP Broadcast (Discovery): Every 1000 ms (1 second).
   * TCP Stream: Asynchronous/Flow-controlled.
       * The host sends data as fast as the network and DAC buffer allow.
       * The DAC's TCP stack will apply backpressure (reduce window size) if the application buffer (1800 points max) is
         full.
       * The host should monitor the "Fullness" reported in ACK responses to optimize sending.

  3. Packet Structure
  The protocol uses a custom TCP-based command-response structure on Port 7765.

  Common Commands:
   * `'?'` (Ping): No payload. Response: ACK.
   * `'p'` (Prepare): Resets buffer. Response: ACK/NAK.
   * `'b'` (Begin): Payload: rate (points per second). Starts playback. Response: ACK.
   * `'d'` (Data): Payload: npoints (count) + npoints * dac_point.
       * Point Structure (16-bit LE integers, 18 bytes total):
           1. Control (Protocol flags)
           2. X (Coordinate)
           3. Y (Coordinate)
           4. R (Red Color)
           5. G (Green Color)
           6. B (Blue Color)
           7. I (Intensity)
           8. U1 (User 1 / Deep Blue)
           9. U2 (User 2 / Yellow)
   * `'s'` (Stop): Stops playback immediately.

  Response Structure:
   * ACK: {'a', command_echo, dac_status_struct}
   * NAK: {'N', command_echo, dac_status_struct}
   * DAC Status Struct: Contains State (Idle/Playing), Buffer Fullness, Current Point Rate, Flags (Underflow/E-stop).

  4. Packet Order (Connection Sequence)
   1. Discovery (Optional): Listen on UDP Port 7654 for broadcasts to find IP/MAC.
   2. Connect: Open TCP connection to DAC IP on Port 7765.
   3. Handshake: Send '?' (Ping) or 'v' (Version) to verify connection.
   4. Setup: Send 'p' (Prepare) to reset the buffer.
   5. Configure: Send 'b' (Begin) with the desired point rate (e.g., 30000).
   6. Stream: Repeatedly send 'd' (Data) packets to keep the buffer full.
       * Note: You must send data faster than the playback rate to prevent underflow.
   7. Termination: Send 's' (Stop) to end the show.

  5. E-stop / Idle Behaviour
   * E-Stop Command: Sending 0x00 or 0xFF triggers an immediate E-stop.
       * Hardware shutter closes.
       * Output zeros.
       * Cleared by sending 'c' command.
   * Underflow (Idle): If the buffer runs empty while playing:
       * The DAC triggers dac_stop_underflow.
       * State changes to IDLE.
       * Output turns off (Blanking).
       * Playback must be restarted with 'p' and 'b'.
   * Watchdog: There is no explicit network watchdog visible in the reviewed code, but TCP keepalives or the underflow
     mechanism effectively act as one (if data stops coming, buffer empties -> stop).

  Summary for Integration
  To drive this DAC:
   1. Discover via UDP 7654.
   2. Connect TCP 7765.
   3. Packet Format: Use the 18-byte struct layout (Control, X, Y, R, G, B, I, U1, U2).
   4. Buffer Management: Keep the DAC's internal buffer (size 1800) full by streaming 'd' packets. Monitor the
      buffer_fullness returned in every ACK.
   5. Safety: Handle the Underflow state (restart stream) and support the E-stop command.