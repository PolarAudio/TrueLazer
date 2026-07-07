//---------------------------------------------------------------------------

#ifndef SDKSocketH
#define SDKSocketH
//---------------------------------------------------------------------------
#pragma pack(4)

enum show_query_id{
	SQID_LIST,
	SQID_INFO,
	SQID_DMX,
	SQID_GET_OPTIMIZER_SETTING,
	SQID_SET_OPTIMIZER_SETTING,
	SQID_START_EXTERN_MODE,
	SQID_STOP_EXTERN_MODE,
	SQID_END
};

#define MAX_SHOW_INDEX (255)
#define MAX_SHOW_NAME_LEN (255)
#define MAX_POINT_COUNT_BIG (2500)
#define DAC_LIST_PORT (8099)
#define UDP_DAC_EXTERNAL_PORT_BEGIN (10000)

typedef unsigned char u8;

struct show_query{
	u8 query_id;
	u8 query_sn_h;
	u8 query_sn_l;
	u8 show_index;
	u8 data[512];
};

struct show_optimizer_setting{
	u8 anchor_points_lit;//the number of the points need to be added when find a light anchor point 
	u8 anchor_points_blanked;//the number of the points need to be added when find a dark anchor point
	u8 interp_distance_lit;//the max distance between two light points, 2 means 0.02, and the distance of the view port from -1.0 to 1.0
	u8 interp_distance_blanked;//the max distance between tow blank points, 2 means 0.02, and the distance of the view port from -1.0 to 1.0
};

struct show_list{
	u8 count;//the total active show number from the Truware software
	u8 endian;//0:little endian, 1:big endia
	u8 reserve2;//no function
	u8 reserve3;//no function
	short udpPort[MAX_SHOW_INDEX];//the udp port which will be used to send ilda frame to the show
};

struct dac_info{
	u8 version[2];//version number of the firmware in ShowBridge or ShowTower
	u8 type;//type number of the ShowBridge or SHowTower
	u8 channel;//channel number of the ShowBridge
	u8 sn[4];//sn number of the ShowBridge or ShowTower
	u8 status[8];//some status of the ShowBrige or ShowTower, status[0] indicate the DAC is online or not, status[1] indicate the working mode of the parent show
};

struct show_info{
	short showId;//show ID, most of the time, is the same as show index
	short udpPort;//the UDP port which will be used to receive ilda frame from remote controller
	dac_info cannerInfo;//the information of the projector(ShowBridge or ShowTower), status[1] included is used to return the working mode
	char showName[MAX_SHOW_NAME_LEN];//show name, which can be changed in Truware software
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

union result_content{
	show_list list;
	show_info showInfo;
	show_optimizer_setting optimizerSetting;
};

struct query_result{
	u8 r1;
	u8 r2;
	u8 r3;
	u8 r4;
	show_query query;
	result_content result;
};

bool IsLittleEnd(void);
void Swap(char ch[], int count);
short Swap(short data);
float Swap(float data);
void PutShort(short &value, void *buffer);
void GetShort(short &value, void *buffer);
void PutFloat(float &value, void *buffer);
void GetFloat(float &value, void *buffer);

#define SWAP(x) x=Swap(x)
#endif
