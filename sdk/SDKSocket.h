#define CLIENT_PORT 8099
#define SERVER_PORT 8089

#include <winsock2.h>
#ifndef SDKSocketH
#define SDKSocketH
#pragma pack(push, 4)

#include "SocketTypes.h"

#include "SocketTypes.h"
#include "Easysocket.h"
#include <vector>
#include <string>

struct show_bridge_info {
    char ip[4];
    unsigned char version;
    int max_pps;
    int max_points;
};

struct safety_zone {
    short x_min;
    short x_max;
    short y_min;
    short y_max;
};

struct point_buffer {
	float x;//the x coordinate of the point, value from -1.0 to 1.0
	float y;//the y coordinate of the point, value from -1.0 to 1.0
	unsigned char blanking;//0: a dark point, 1: a light point with color
	unsigned char r;//red color of the point
	unsigned char g;//green color of the point
	unsigned char b;//blue color of the point
};

struct frame_buffer {
	short count;//total points number in the frame, most of the case, should be less than 1000
	unsigned char status;//should be always 0
	unsigned char delay;//should be always o
	point_buffer points[2500];//the value of the points
};

class SDKSocket
{
public:
    SDKSocket(void);
    ~SDKSocket(void);
    void init_udp_socket(SocketLib::ipaddress p_addr = 0);
    int get_interfaces(std::vector<std::string> &interfaces);
    int scan_for_show_bridge(std::vector<std::string> &interfaces);
    int get_show_bridge_count(void);
    bool get_show_bridge_info(int index, show_bridge_info &info);
    bool select_show_bridge(int index);
    bool send_frame(frame_buffer &frame);
    bool play(void);
    bool stop(void);
    bool pause(void);
    bool go_on(void);
    bool set_pps(int pps);
    bool set_output_scale(float x_scale, float y_scale);
    bool set_output_offset(float x_offset, float y_offset);
    bool set_color_map(unsigned char *color_map);
    bool set_blanking_delay(int delay);
    bool set_output_mode(int mode);
    bool set_safety_zone(safety_zone &zone);
    bool get_safety_zone(safety_zone &zone);
    bool set_output_name(char *name);
    bool get_output_name(char *name);
    bool reboot(void);

public:
    bool is_udp_socket_inited;
private:
    bool isLittleEnd;
    show_bridge_info show_bridge_list[256];
    int show_bridge_count;
    int selected_show_bridge_index;
    SocketLib::UDPSocket *udp_socket;
};


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
#pragma pack(pop)
#endif
