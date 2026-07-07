#pragma once
#include "Easysocket.h"
#include "SDKSocket.h"

class DameiSDK
{
private:
	bool inited;
	bool isSameEndian;
	SocketLib::ipaddress ipAddress;
	SocketLib::UDPSocket *udpSocket;
	show_list showList;
public:
	DameiSDK();
	~DameiSDK();
	bool Init(char ip[4]);
	bool GetShowList(show_list &sList);
	bool IsSameEndian(void){return isSameEndian;};
	bool GetShowInfo(int showIndex, show_info &showInfo);
	bool SendDmxToShow(int showIndex, char data[]);
	bool GetShowOptimizerSetting(int showIndex, show_optimizer_setting &setting);
	bool SetShowOptimizerSetting(int showIndex, show_optimizer_setting &setting);
	bool SendPointsToShow(int showIndex, frame_buffer &frameBuffer);
	bool SetShowExternMode(int showIndex, bool externMode);
};

