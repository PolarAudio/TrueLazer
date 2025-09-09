#ifndef DAMEISDK_H
#define DAMEISDK_H

#include "SocketTypes.h"
#include "SDKSocket.h"
#include <vector>
#include <string>

class DameiSDK {
public:
    DameiSDK();
    ~DameiSDK();

    bool Init(SocketLib::ipaddress ip);
    bool Init(SocketLib::ipaddress ip, SocketLib::ipaddress local_ip);
    bool GetShowList(show_list &sList);
    bool GetShowInfo(int showIndex, show_info &showInfo);
    bool SendDmxToShow(int showIndex, char data[]);
    bool GetShowOptimizerSetting(int showIndex, show_optimizer_setting &setting);
    bool SetShowOptimizerSetting(int showIndex, show_optimizer_setting &setting);
    bool SetShowExternMode(int showIndex, bool externMode);
    bool SendPointsToShow(int showIndex, frame_buffer &frameBuffer);

private:
    SocketLib::ipaddress ipAddress;
    show_list showList;
    bool isSameEndian;
    bool inited;
    SocketLib::UDPSocket *udpSocket;
    SDKSocket *sdkSocket;

    public:
    SocketLib::ipaddress GetLocalIpAddress() { printf("DameiSDK::GetLocalIpAddress - Returning: %lu\n", ipAddress); return ipAddress; }
    SDKSocket* getSdkSocket() { return sdkSocket; }
};

#endif
