#include <iostream>
#include "DameiSDK.h"
using namespace std;

#include "SDKSocket.cpp"
#include "DameiSDK.cpp"
#include "EasySocket.cpp"
#include "SocketErrors.cpp"

bool GetIPFromString(std::string str, unsigned char ip[4])
{
	bool result = true;
	std::string ipNum = "";
	for(int i=0; i<4; i++){
		size_t pos = str.find(".");
		if(i==3) pos = str.length();
		if(pos != str.npos)
		{
			ipNum = str.substr(0, pos);
			try
			{
				ip[i] = atoi(ipNum.c_str());
				if(i!=3) str = str.substr(pos+1, str.length());
			}
			catch(const std::exception& e)
			{
				result = false;
				break;
			}
		}
	}
	return result;
}

int main() {
	bool debugMode = false;
	char defaultDmxData[] = {0, 0, 34, };
	DameiSDK sdk;
	unsigned char ip[4] = {192, 168, 43, 161};
	string ipStr = "192.168.43.161";
	do{
		cout << "Please enter IP address which ShowBridge software is using. (xxx.xxx.xxx.xxx)\r\n";
		if(!debugMode) getline(cin, ipStr);
	}while (!GetIPFromString(ipStr, ip));
	
	bool ir = sdk.Init((char *)ip);
	cout << "Init on IP: ";
	for(int i=0; i<4; i++){
		cout << (int)ip[i];
		if(i != 3) cout << ".";
	}
	if(ir) cout << " success.\r\n";
	else cout << " failed.\r\n";
	cout << "\r\nPlease enter commands.\r\n";
	string cmd = "";
	show_list sList;
	while(true){
		cout << "\r\n>>";
		if(!debugMode){
			getline(cin, cmd);
		}else{
			if(cmd == "") cmd = "list";
			else if(cmd == "list") cmd = "frame";
			else if(cmd == "frame") cmd = "info";
			else if(cmd == "info") cmd = "exit";
		}
		if(cmd == "exit"){
			exit(0);
		}else if(cmd == "list"){
			bool res = sdk.GetShowList(sList);
			if(res){
				cout << "Got total show count: " << (int)sList.count << "\r\n";
				cout << "--------------------------------------------------\r\n";
				for(int i=0; i<sList.count; i++){
					cout << "Show " << i << " UDP port: " << sList.udpPort[i] << "\r\n";
				}
			}else{
				cout << "Get show list failed.\r\n";
			}
		}else if(cmd == "info"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int i=0; i<sList.count; i++){
				show_info showInfo;
				bool res = sdk.GetShowInfo(i, showInfo);
				if(res){
					cout << "Show " << i << " ID: " << showInfo.showId << "\r\n";
					cout << "Show " << i << " name: " << showInfo.showName << "\r\n";
					cout << "Show " << i << " UDP port: " << showInfo.udpPort << "\r\n";
					cout << "Show " << i << " mode: " << (int)showInfo.cannerInfo.status[1] << "\r\n";
					cout << "Show " << i << " SN: " << (int)showInfo.cannerInfo.sn[0] << (int)showInfo.cannerInfo.sn[1]
						<< (int)showInfo.cannerInfo.sn[2] << (int)showInfo.cannerInfo.sn[3] << "\r\n";
				}else{
					cout << "Get Show " << i << " info failed.\r\n";
				}
			}
		}else if(cmd == "dmx"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int i=0; i<sList.count; i++){
				char dmxData[512];
				memset(dmxData, 255, sizeof(dmxData));
				dmxData[0] = 0;
				dmxData[1] = 0;
				dmxData[2] = 50;

				bool res = sdk.SendDmxToShow(i, dmxData);
				if(res){
					cout << "Show " << i << " process DMX " << "sucess.\r\n";
				}else{
					cout << "Show " << i << " process DMX failed.\r\n";
				}
			}
		}else if(cmd == "get opt"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int i=0; i<sList.count; i++){
				show_optimizer_setting showOpt;
				bool res = sdk.GetShowOptimizerSetting(i, showOpt);
				if(res){
					cout << "Show " << i << " optimizer anchor_points_blanked: " << (int)showOpt.anchor_points_blanked << "\r\n";
					cout << "Show " << i << " optimizer anchor_points_lit: " << (int)showOpt.anchor_points_lit << "\r\n";
					cout << "Show " << i << " optimizer interp_distance_blanked: " << (int)showOpt.interp_distance_blanked << "\r\n";
					cout << "Show " << i << " optimizer interp_distance_lit: " << (int)showOpt.interp_distance_lit << "\r\n";
				}else{
					cout << "Show " << i << " get optimizer setting failed.\r\n";
				}
			}
		}else if(cmd == "set opt"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int i=0; i<sList.count; i++){
				show_optimizer_setting showOpt;
				showOpt.anchor_points_blanked = 4;
				showOpt.anchor_points_lit = 5;
				showOpt.interp_distance_blanked = 3;
				showOpt.interp_distance_lit = 2;
				bool res = sdk.SetShowOptimizerSetting(i, showOpt);
				if(res){
					cout << "Show " << i << " optimizer anchor_points_blanked: " << (int)showOpt.anchor_points_blanked << "\r\n";
					cout << "Show " << i << " optimizer anchor_points_lit: " << (int)showOpt.anchor_points_lit << "\r\n";
					cout << "Show " << i << " optimizer interp_distance_blanked: " << (int)showOpt.interp_distance_blanked << "\r\n";
					cout << "Show " << i << " optimizer interp_distance_lit: " << (int)showOpt.interp_distance_lit << "\r\n";
				}else{
					cout << "Show " << i << " set optimizer setting failed.\r\n";
				}
			}
		}else if(cmd == "start frame"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int i=0; i<sList.count; i++){
				bool res = sdk.SetShowExternMode(i, true);
				if(res){
					cout << "Show " << i << " start external mode success.\r\n";
				}else{
					cout << "Show " << i << " start external mode failed.\r\n";
				}
			}
		}else if(cmd == "stop frame"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int i=0; i<sList.count; i++){
				bool res = sdk.SetShowExternMode(i, false);
				if(res){
					cout << "Show " << i << " stop external mode success.\r\n";
				}else{
					cout << "Show " << i << " stop external mode failed.\r\n";
				}
			}
		}else if(cmd == "frame"){
			cout << "Total show count: " << (int)sList.count << "\r\n";
			cout << "--------------------------------------------------\r\n";
			for(int s=0; s<sList.count; s++){
				frame_buffer frameBuffer;
				point_buffer pb = {0.5, 0.5, 0, 255, 0, 0};
				frameBuffer.count = 4;
				frameBuffer.delay = 255;
				frameBuffer.status = 0;
				frameBuffer.points[0] = pb;//{0.5, 0.5, 0, 255, 0, 0}
				pb.y = -0.5;
				frameBuffer.points[1] = pb;//{0.5, -0.5, 0, 255, 0, 0}
				pb.x = -0.5; pb.y = 0;
				frameBuffer.points[2] = pb;//{-0.5, 0.0, 0, 255, 0, 0}
				pb.x = 0.5; pb.y = 0.5;
				frameBuffer.points[3] = pb;//{0.5, 0.5, 0, 255, 0, 0}
				for(int i=0; i<1000; i++){
					bool res = sdk.SendPointsToShow(s, frameBuffer);
					if(res){
						cout << "Show " << s << " process frame success.\r\n";
					}else{
						cout << "Show " << s << " process frame failed.\r\n";
						break;
					}
				}
			}
		}

	}
}