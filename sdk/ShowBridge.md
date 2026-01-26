Our *original* ShowBridge protocol follows this pattern (this section describes the native ShowBridge protocol, not the new IDN integration):
	Broadcast Message to 255.255.255.255:8089 with
    Command: 6 bytes = Target IP (169.254.25.104) + Flags (163, 31).
	
	Answer from DAC to "Target IP":8099
    Response: 16 bytes = Vendor ID (22,26) + Type (1) + Channel (1/2) + Device ID (630380)

	16 1a 01 01 00 20 00 25 00 00 00 00 00 00 00 00    	ip 25.69  ch 1
	16 1a 01 01 00 26 00 3f 00 00 00 00 00 00 00 00 	ip 25.104 ch 1
	16 1a 01 02 00 20 00 25 00 00 00 00 00 00 00 00 	ip 25.69  ch 2
	16 1a 01 02 00 26 00 3f 00 00 00 00 00 00 00 00   	ip 25.104 ch 2


**DAMEI SHOWBRIDGE SDK INFORMATION**
*This information is not Final and mostly applies to the SDK for Truwave communication.*

// Define the required structures
typedef unsigned char u8;
typedef signed short INT16;
typedef signed char INT8;
typedef unsigned short u16;

const MAX_POINT_COUNT_BIG = 2500
const MAX_POINT_COUNT_NORMAL = 1700  //this value actually be used, point more than this will be droped
const MAX_UDP_BUFFER_SIZE = 4608
const MAX_DAMEI_DAC_X_VALUE = 0XFFF
const MAX_DAMEI_DAC_Y_VALUE = 0XFFF
const DAMEI_DAC_X_PROTECT_VALUE = 100
const DAMEI_DAC_Y_PROTECT_VALUE = 100

struct show_optimizer_setting{
	u8 anchor_points_lit;//the number of the points need to be added when find a light anchor point 
	u8 anchor_points_blanked;//the number of the points need to be added when find a dark anchor point
	u8 interp_distance_lit;//the max distance between two light points, 2 means 0.02, and the distance of the view port from -1.0 to 1.0
	u8 interp_distance_blanked;//the max distance between tow blank points, 2 means 0.02, and the distance of the view port from -1.0 to 1.0
};

struct dac_info{
	u8 version[2];//version number of the firmware in ShowBridge or ShowTower
	u8 type;//type number of the ShowBridge or SHowTower
	u8 channel;//channel number of the ShowBridge
	u8 sn[4];//sn number of the ShowBridge or ShowTower
	u8 status[8];//some status of the ShowBrige or ShowTower, status[0] indicate the DAC is online or not, status[1] indicate the working mode of the parent show
};
struct point_buffer {
	float x;//the x coordinate of the point, value from -1.0 to 1.0
	float y;//the y coordinate of the point, value from -1.0 to 1.0
	u8 blanking;//0: a dark point, 1: a light point with color
	u8 r;//red color of the point
	u8 g;//green color of the point
	u8 b;//blue color of the point
};
struct frame_buffer {
	short count;//total points number in the frame, most of the case, should be less than 1000
	u8 status;//should be always 0
	u8 delay;//should be always o
	point_buffer points[MAX_POINT_COUNT_BIG];//the value of the points
};

// Point structure for ILDA frames
typedef struct PointBufferTag {
    INT16 x;//range from 0 to 0xFFF
    INT16 y;//range from 0 to 0xFFF
    INT8 blanking;
    INT8 r;
    INT8 g;
    INT8 b;
} PointBuffer;

// Frame structure for ILDA frames
typedef struct FrameBufferTag {
    INT16 count;
    INT8 status;
    INT8 delay;
    PointBuffer points[MAX_POINT_COUNT_BIG];
} FrameBuffer;


// Test sending a frame if projectors are available
    if (!projectors.empty()) {
        std::cout << "Testing frame transmission to first projector..." << std::endl;
        
        // Create a simple test frame with a few points
        FrameBuffer frame = {};
        frame.count = 5;  // Number of points in the frame
        frame.status = 0;
        frame.delay = 0;
        
        // Add some test points (creating a simple shape)
        for (int i = 0; i < 5 && i < MAX_POINT_COUNT_BIG; ++i) {
            frame.points[i].x = static_cast<INT16>((i - 2) * 200);  // Simple x positions
            frame.points[i].y = static_cast<INT16>((i % 2 == 0) ? 200 : -200);  // Alternate y positions
            frame.points[i].blanking = (i % 3 == 0) ? 0 : 1;  // Some blanking
            frame.points[i].r = static_cast<INT8>((i * 50) % 255);  // Varying red
            frame.points[i].g = static_cast<INT8>((i * 75) % 255);  // Varying green
            frame.points[i].b = static_cast<INT8>((i * 100) % 255);  // Varying blue
        }
        
        std::cout << "Sending test frame with " << frame.count << " points to projector 0..." << std::endl;
        bool frameSent = sdk.SendIldaFrameToProjector(0, frame);
        std::cout << (frameSent ? "[SUCCESS] Frame sent successfully!" : "[ERROR] Failed to send frame") << std::endl;
        std::cout << std::endl;
		if (!frameSent) {
			std::cout << "Error number: " << GetLastError() << std::endl;
		}
    } else {
        std::cout << "No projectors found to test frame transmission." << std::endl;
        std::cout << "Make sure projectors are available on the network to receive frames." << std::endl;
        std::cout << std::endl;
    }
	// Test setting projector settings if projectors are available
    if (!projectors.empty()) {
        std::cout << "Testing projector setting configuration..." << std::endl;
        
        // Create a test setting structure
		projector_setting setting = DameiSDKDirect::MakeDefaultSettingData();
        setting.ip[0] = 192;
        setting.ip[1] = 168;
        setting.ip[2] = 1;
        setting.ip[3] = 100;
        setting.gate_way[0] = 192;
        setting.gate_way[1] = 168;
        setting.gate_way[2] = 1;
        setting.gate_way[3] = 1;
        
        // Set some basic scan settings
        setting.ss.colorShift = 4;      
        setting.ss.endPoints = 2;    
        setting.ss.pps = 30;           
        setting.ss.startPoints = 2;

        std::cout << "Sending test settings to projector 0..." << std::endl;
        bool settingsSent = sdk.SetProjectorSetting(0, setting);
        std::cout << (settingsSent ? "[SUCCESS] Settings sent successfully!" : "[ERROR] Failed to send settings") << std::endl;
        std::cout << std::endl;
    }