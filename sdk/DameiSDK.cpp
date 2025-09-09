#include <winsock2.h>
#include "Easysocket.h"
#include "DameiSDK.h"
#include "SDKSocket.h"

DameiSDK::DameiSDK()
{
	memset(&showList, 0, sizeof(showList));
	isSameEndian = true; //suppose we have same endian
	inited = false;
    sdkSocket = new SDKSocket();
}

DameiSDK::~DameiSDK()
{
    delete sdkSocket;
}

bool DameiSDK::Init(SocketLib::ipaddress ip)
{
    printf("DameiSDK::Init - Received IP: %lu\n", ip);
	ipAddress = ip;

    sdkSocket->init_udp_socket(ip); // Initialize the SDKSocket's UDP socket with the specific local_ip
    inited = sdkSocket->is_udp_socket_inited; // Check if SDKSocket's UDP socket was initialized successfully

    // Initialize DameiSDK's own UDP socket
    if (udpSocket) {
        delete udpSocket;
        udpSocket = nullptr;
    }
    udpSocket = new SocketLib::UDPSocket(DAC_LIST_PORT, ip); // Initialize DameiSDK's UDP socket with the specific local_ip

	return inited;
}

bool DameiSDK::GetShowList(show_list &sList)
{
	bool res = false;
	u8 myEndian = IsLittleEnd()?0:1;
	if (inited) {
		struct in_addr addr;
		addr.s_addr = ipAddress;
		show_query query;
		query_result result;
		query.query_id = SQID_LIST;
		query.query_sn_h = 0;
		query.query_sn_l = 0;
		query.show_index = -1;
		udpSocket->UDPSendTo(addr.s_addr, DAC_LIST_PORT, (const char *)&query, sizeof(query));
//		sleep(1);
		int rCount = udpSocket->UDPReceive((char *)&result, sizeof(result));
		if (rCount == sizeof(result)) {
			res = result.r1 > 0 ? true : false;
			showList = result.result.list;
			isSameEndian = (myEndian == showList.endian);
			if(!isSameEndian){
				for(int i=0; i<showList.count; i++){
					showList.udpPort[i] = Swap(showList.udpPort[i]);
				}
			}
			sList = showList;
		}
	}
	return res;
}

bool DameiSDK::GetShowInfo(int showIndex, show_info &showInfo)
{
	bool res = false;
	if (inited) {
		show_query query;
		query_result result;
		int deviceCount = showList.count;
		if (showIndex < deviceCount) {
			query.query_id = SQID_INFO;
			query.query_sn_h = 0;
			query.query_sn_l = 1;
			query.show_index = showIndex;
			udpSocket->UDPSendTo(ipAddress, DAC_LIST_PORT, (const char *)&query, sizeof(query));
			//			Sleep(500);
			int rCount = udpSocket->UDPReceive((char *)&result, sizeof(result));
			if (rCount == sizeof(result)) {
				showInfo = result.result.showInfo;
				res = result.r1 > 0 ? true : false;
				if(!isSameEndian){
					SWAP(showInfo.showId);
					SWAP(showInfo.udpPort);
				}
			}
		}
	}
	return res;
}

bool DameiSDK::SendDmxToShow(int showIndex, char data[])
{
	bool res = false;
	if (inited) {
		show_query query;
		query_result result;
		int deviceCount = showList.count;
		if (showIndex < deviceCount) {
			query.query_id = SQID_DMX;
			query.query_sn_h = 0;
			query.query_sn_l = 2;
			query.show_index = showIndex;
			memcpy(query.data, data, sizeof(query.data));
			udpSocket->UDPSendTo(ipAddress, DAC_LIST_PORT, (const char *)&query, sizeof(query));
			int rCount = udpSocket->UDPReceive((char *)&result, sizeof(result));
			if (rCount == sizeof(result)) {
				res = result.r1 > 0 ? true : false;
			}
		}
	}
	return res;
}

bool DameiSDK::GetShowOptimizerSetting(int showIndex, show_optimizer_setting &setting)
{
	bool res = false;
	if (inited) {
		show_query query;
		query_result result;
		int deviceCount = showList.count;
		if (showIndex < deviceCount) {
			query.query_id = SQID_GET_OPTIMIZER_SETTING;
			query.query_sn_h = 0;
			query.query_sn_l = 3;
			query.show_index = showIndex;
			udpSocket->UDPSendTo(ipAddress, DAC_LIST_PORT, (const char *)&query, sizeof(query));
			//			Sleep(500);
			int rCount = udpSocket->UDPReceive((char *)&result, sizeof(result));
			if (rCount == sizeof(result)) {
				memcpy(&setting, &result.result.optimizerSetting, sizeof(setting));
				res = result.r1 > 0 ? true : false;
			}
		}
	}
	return res;
}

bool DameiSDK::SetShowOptimizerSetting(int showIndex, show_optimizer_setting &setting)
{
	bool res = false;
	if (inited) {
		show_query query;
		query_result result;
		int deviceCount = showList.count;
		if (showIndex < deviceCount) {
			query.query_id = SQID_SET_OPTIMIZER_SETTING;
			query.query_sn_h = 0;
			query.query_sn_l = 4;
			query.show_index = showIndex;
			memcpy(query.data, &setting, sizeof(setting));
			udpSocket->UDPSendTo(ipAddress, DAC_LIST_PORT, (const char *)&query, sizeof(query));
			int rCount = udpSocket->UDPReceive((char *)&result, sizeof(result));
			if (rCount == sizeof(result)) {
				res = result.r1 > 0 ? true : false;
			}
		}
	}
	return res;	
}

bool DameiSDK::SetShowExternMode(int showIndex, bool externMode)
{
	bool res = false;
	if (inited) {
		show_query query;
		query_result result;
		int deviceCount = showList.count;
		if (showIndex < deviceCount) {
			if(externMode) query.query_id = SQID_START_EXTERN_MODE;
			else query.query_id = SQID_STOP_EXTERN_MODE; 
			query.query_sn_h = 0;
			query.query_sn_l = 5;
			query.show_index = showIndex;
			udpSocket->UDPSendTo(ipAddress, DAC_LIST_PORT, (const char *)&query, sizeof(query));
			int rCount = udpSocket->UDPReceive((char *)&result, sizeof(result));
			if (rCount == sizeof(result)) {
				res = result.r1 > 0 ? true : false;
			}
		}
	}
	return res;	
}

bool DameiSDK::SendPointsToShow(int showIndex, frame_buffer &frameBuffer)
{
	bool res = false;
	if(showIndex < showList.count && showList.udpPort[showIndex] > UDP_DAC_EXTERNAL_PORT_BEGIN){
		struct in_addr addr;
		addr.s_addr = ipAddress;
		frameBuffer.status = 0;
		if(!isSameEndian){
			for(int i=0; i<frameBuffer.count; i++){
				SWAP(frameBuffer.points[i].x);
				SWAP(frameBuffer.points[i].y);
			}
			SWAP(frameBuffer.count);
		}
		int rCount = udpSocket->UDPSendTo(addr.s_addr, showList.udpPort[showIndex], (const char*)&frameBuffer, sizeof(frameBuffer));
		if(rCount == sizeof(frameBuffer)){
			res = true;
		}
	}
	return res;
}





bool DameiSDK::Init(SocketLib::ipaddress ip, SocketLib::ipaddress local_ip)
{
    ipAddress = ip;
    sdkSocket->init_udp_socket(local_ip); // Initialize SDKSocket's UDP socket with specific local_ip
    inited = sdkSocket->is_udp_socket_inited; // Check if SDKSocket's UDP socket was initialized successfully

    // Initialize DameiSDK's own UDP socket
    if (udpSocket) {
        delete udpSocket;
        udpSocket = nullptr;
    }
    udpSocket = new SocketLib::UDPSocket(DAC_LIST_PORT, local_ip); // Initialize DameiSDK's UDP socket with specific local_ip

    return inited;
}
