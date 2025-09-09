//---------------------------------------------------------------------------


#pragma hdrstop

#include "SDKSocket.h"
#include <stdio.h>
#include <memory.h>

//---------------------------------------------------------------------------


bool IsLittleEnd(void){
    union {  
    short s;  
    char c[sizeof(short)];  
    } unShort;  
    unShort.s = 0x0102;  
    return (unShort.c[0] == 0x2);
}

void Swap(char ch[], int count) {  
    int size = count / 2;  
    int max = count - 1;  
    for (int i = 0; i < size; i++) {  
    char t = ch[i];  
    ch[i] = ch[max - i];  
    ch[max - i] = t;  
    } 
}

short Swap(short data) {  
    union {  
    short _i;  
    char _c[sizeof(short)];  
    } un;  
    un._i = data;  
    Swap(un._c, sizeof(short));  
    return un._i;  
}

float Swap(float data) {  
    union {  
    float _i;  
    char _c[sizeof(float)];  
    } un;  
    un._i = data;  
    Swap(un._c, sizeof(float));  
    return un._i;  
}

void PutShort(short &value, void *buffer)
{
    short s = value;
    if(!IsLittleEnd()) s = Swap(value);
    memcpy(buffer, &s, sizeof(short)); 
}

void GetShort(short &value, void *buffer)
{
    char buf[sizeof(short)];
    memcpy(buf, buffer, sizeof(short));
    if(!IsLittleEnd()) Swap(buf, sizeof(short));
    memcpy(&value, buf, sizeof(short));
}

void PutFloat(float &value, void *buffer)
{
    float s = value;
    if(!IsLittleEnd()) s = Swap(s);
    memcpy(buffer, &s, sizeof(float)); 
}

void GetFloat(float &value, void *buffer)
{
    char buf[sizeof(short)];
    memcpy(buf, buffer, sizeof(float));
    if(!IsLittleEnd()) Swap(buf, sizeof(float));
    memcpy(&value, buf, sizeof(float));
}



SDKSocket::SDKSocket(void)
{
    printf("SDKSocket::SDKSocket - Entry\n");
    isLittleEnd = IsLittleEnd();
    memset(show_bridge_list, 0, sizeof(show_bridge_list));
    show_bridge_count = 0;
    selected_show_bridge_index = -1;
    udp_socket = 0;
    is_udp_socket_inited = false;
    printf("SDKSocket::SDKSocket - Exit\n");
}

SDKSocket::~SDKSocket(void)
{
    printf("SDKSocket::~SDKSocket - Entry\n");
    if(is_udp_socket_inited)
    {
        udp_socket->Close();
        delete udp_socket;
    }
    printf("SDKSocket::~SDKSocket - Exit\n");
}

void SDKSocket::init_udp_socket(SocketLib::ipaddress p_addr /* = 0 */)
{
    printf("SDKSocket::init_udp_socket - Entry\n");
    if(is_udp_socket_inited) {
        printf("SDKSocket::init_udp_socket - Socket already inited, returning.\n");
        return;
    }
    try
    {
        printf("SDKSocket::init_udp_socket - Creating UDPSocket\n");
        udp_socket = new SocketLib::UDPSocket(CLIENT_PORT, p_addr);
        is_udp_socket_inited = true;
        printf("SDKSocket::init_udp_socket - UDPSocket created successfully\n");
    }
    catch(SocketLib::Exception e)
    {
        printf("SDKSocket::init_udp_socket - Exception caught: ");
        e.PrintError();
        is_udp_socket_inited = false;
    }
    printf("SDKSocket::init_udp_socket - Exit\n");
}

int SDKSocket::get_interfaces(std::vector<std::string> &interfaces)
{
    printf("SDKSocket::get_interfaces - Entry\n");
    init_udp_socket();
    if(!is_udp_socket_inited) {
        printf("SDKSocket::get_interfaces - UDP socket not inited, returning 0.\n");
        return 0;
    }
    int result = udp_socket->get_interfaces(interfaces);
    printf("SDKSocket::get_interfaces - Found %d interfaces, Exit\n", result);
    return result;
}

int SDKSocket::scan_for_show_bridge(std::vector<std::string> &interfaces)
{
    printf("SDKSocket::scan_for_show_bridge - Entry\n");
    char broadcast_address[4];
    char send_data[4];
    char recv_data[1024];
    char remote_ip[4];
    int i;
    int j;
    int recv_count;
    int interface_count;
    int current_show_bridge_count;
    unsigned long ip;
    unsigned long sub_mask;
    unsigned long broadcast_ip;
    bool is_found;

    init_udp_socket();
    if(!is_udp_socket_inited) {
        printf("SDKSocket::scan_for_show_bridge - UDP socket not inited, returning 0.\n");
        return 0;
    }

    show_bridge_count = 0;
    memset(show_bridge_list, 0, sizeof(show_bridge_list));

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x00; // command, 0 for scan

    interface_count = interfaces.size();
    printf("SDKSocket::scan_for_show_bridge - Iterating through %d interfaces\n", interface_count);
    for(i=0; i<interface_count; i++)
    {
        printf("SDKSocket::scan_for_show_bridge - Getting IP and Mask for interface %s\n", interfaces[i].c_str());
        udp_socket->get_ip_and_mask(interfaces[i].c_str(), ip, sub_mask);
        broadcast_ip = ip | (~sub_mask);
        broadcast_address[0] = (broadcast_ip >> 0) & 0xff;
        broadcast_address[1] = (broadcast_ip >> 8) & 0xff;
        broadcast_address[2] = (broadcast_ip >> 16) & 0xff;
        broadcast_address[3] = (broadcast_ip >> 24) & 0xff;
        printf("SDKSocket::scan_for_show_bridge - Setting broadcast mode\n");
        udp_socket->set_broadcast(true);
        printf("SDKSocket::scan_for_show_bridge - Sending UDP broadcast to %d.%d.%d.%d:%d\n", broadcast_address[0], broadcast_address[1], broadcast_address[2], broadcast_address[3], SERVER_PORT);
        udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(broadcast_address), SERVER_PORT, send_data, 4);
    }

    udp_socket->set_time_out(2000); // 2000ms
    current_show_bridge_count = 0;
    printf("SDKSocket::scan_for_show_bridge - Entering receive loop\n");
    while(1)
    {
        recv_count = udp_socket->UDPReceiveFrom(recv_data, 1024, remote_ip);
        if(recv_count > 0)
        {
            printf("SDKSocket::scan_for_show_bridge - Received %d bytes from %d.%d.%d.%d\n", recv_count, remote_ip[0], remote_ip[1], remote_ip[2], remote_ip[3]);
            if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x01)
            {
                is_found = false;
                for(j=0; j<current_show_bridge_count; j++)
                {
                    if(memcmp(show_bridge_list[j].ip, remote_ip, 4) == 0)
                    {
                        is_found = true;
                        break;
                    }
                }
                if(!is_found)
                {
                    memcpy(show_bridge_list[current_show_bridge_count].ip, remote_ip, 4);
                    show_bridge_list[current_show_bridge_count].version = recv_data[4];
                    show_bridge_list[current_show_bridge_count].max_pps = recv_data[5] * 1000;
                    show_bridge_list[current_show_bridge_count].max_points = 5000;
                    current_show_bridge_count ++;
                    printf("SDKSocket::scan_for_show_bridge - Found new show bridge\n");
                }
            }
        }
        else
        {
            printf("SDKSocket::scan_for_show_bridge - Receive timed out or error, breaking loop\n");
            break;
        }
    }
    show_bridge_count = current_show_bridge_count;
    printf("SDKSocket::scan_for_show_bridge - Found total %d show bridges, Exit\n", show_bridge_count);
    return show_bridge_count;
}

int SDKSocket::get_show_bridge_count(void)
{
    return show_bridge_count;
}

bool SDKSocket::get_show_bridge_info(int index, show_bridge_info &info)
{
    if(index < 0 || index >= show_bridge_count) return false;
    memcpy(&info, &show_bridge_list[index], sizeof(show_bridge_info));
    return true;
}

bool SDKSocket::select_show_bridge(int index)
{
    if(index < 0 || index >= show_bridge_count) return false;
    selected_show_bridge_index = index;
    return true;
}

bool SDKSocket::send_frame(frame_buffer &frame)
{
    char send_data[sizeof(frame_buffer) + 4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x10; // command, 0x10 for send frame

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &frame, sizeof(frame_buffer));
    }
    else
    {
        frame_buffer temp_frame;
        memcpy(&temp_frame, &frame, sizeof(frame_buffer));
        Swap((short &)temp_frame.count);
        for(int i=0; i<temp_frame.count; i++)
        {
            Swap((short &)temp_frame.points[i].x);
            Swap((short &)temp_frame.points[i].y);
            Swap((short &)temp_frame.points[i].r);
            Swap((short &)temp_frame.points[i].g);
            Swap((short &)temp_frame.points[i].b);
            
        }
        memcpy(send_data + 4, &temp_frame, sizeof(frame_buffer));
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, sizeof(frame_buffer) + 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x11)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::play(void)
{
    char send_data[4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x12; // command, 0x12 for play

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x13)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::stop(void)
{
    char send_data[4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x14; // command, 0x14 for stop

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x15)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::pause(void)
{
    char send_data[4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x16; // command, 0x16 for pause

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x17)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::go_on(void)
{
    char send_data[4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x18; // command, 0x18 for go on

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x19)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_pps(int pps)
{
    char send_data[8];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x1A; // command, 0x1A for set pps

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &pps, 4);
    }
    else
    {
        int temp_pps = pps;
        Swap((char *)&temp_pps, 4);
        memcpy(send_data + 4, &temp_pps, 4);
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 8);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x1B)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_output_scale(float x_scale, float y_scale)
{
    char send_data[12];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x1C; // command, 0x1C for set output scale

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &x_scale, 4);
        memcpy(send_data + 8, &y_scale, 4);
    }
    else
    {
        float temp_x_scale = x_scale;
        float temp_y_scale = y_scale;
        Swap((char *)&temp_x_scale, 4);
        Swap((char *)&temp_y_scale, 4);
        memcpy(send_data + 4, &temp_x_scale, 4);
        memcpy(send_data + 8, &temp_y_scale, 4);
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 12);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x1D)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_output_offset(float x_offset, float y_offset)
{
    char send_data[12];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x1E; // command, 0x1E for set output offset

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &x_offset, 4);
        memcpy(send_data + 8, &y_offset, 4);
    }
    else
    {
        float temp_x_offset = x_offset;
        float temp_y_offset = y_offset;
        Swap((char *)&temp_x_offset, 4);
        Swap((char *)&temp_y_offset, 4);
        memcpy(send_data + 4, &temp_x_offset, 4);
        memcpy(send_data + 8, &temp_y_offset, 4);
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 12);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x1F)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_color_map(unsigned char *color_map)
{
    char send_data[260];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x20; // command, 0x20 for set color map

    memcpy(send_data + 4, color_map, 256);

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 260);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x21)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_blanking_delay(int delay)
{
    char send_data[8];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x22; // command, 0x22 for set blanking delay

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &delay, 4);
    }
    else
    {
        int temp_delay = delay;
        Swap((char *)&temp_delay, 4);
        memcpy(send_data + 4, &temp_delay, 4);
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 8);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x23)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_output_mode(int mode)
{
    char send_data[8];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x24; // command, 0x24 for set output mode

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &mode, 4);
    }
    else
    {
        int temp_mode = mode;
        Swap((char *)&temp_mode, 4);
        memcpy(send_data + 4, &temp_mode, 4);
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 8);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x25)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_safety_zone(safety_zone &zone)
{
    char send_data[sizeof(safety_zone) + 4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x26; // command, 0x26 for set safety zone

    if(isLittleEnd)
    {
        memcpy(send_data + 4, &zone, sizeof(safety_zone));
    }
    else
    {
        safety_zone temp_zone;
        memcpy(&temp_zone, &zone, sizeof(safety_zone));
        Swap((short &)temp_zone.x_min);
        Swap((short &)temp_zone.x_max);
        Swap((short &)temp_zone.y_min);
        Swap((short &)temp_zone.y_max);
        memcpy(send_data + 4, &temp_zone, sizeof(safety_zone));
    }

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, sizeof(safety_zone) + 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x27)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::get_safety_zone(safety_zone &zone)
{
    char send_data[4];
    char recv_data[sizeof(safety_zone) + 4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x28; // command, 0x28 for get safety zone

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, sizeof(safety_zone) + 4, remote_ip);
    if(recv_count == sizeof(safety_zone) + 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x29)
        {
            if(isLittleEnd)
            {
                memcpy(&zone, recv_data + 4, sizeof(safety_zone));
            }
            else
            {
                safety_zone temp_zone;
                memcpy(&temp_zone, recv_data + 4, sizeof(safety_zone));
                Swap((short &)temp_zone.x_min);
                Swap((short &)temp_zone.x_max);
                Swap((short &)temp_zone.y_min);
                Swap((short &)temp_zone.y_max);
                memcpy(&zone, &temp_zone, sizeof(safety_zone));
            }
            result = true;
        }
    }
    return result;
}

bool SDKSocket::set_output_name(char *name)
{
    char send_data[36];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x2A; // command, 0x2A for set output name

    memcpy(send_data + 4, name, 32);

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 36);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x2B)
        {
            result = true;
        }
    }
    return result;
}

bool SDKSocket::get_output_name(char *name)
{
    char send_data[4];
    char recv_data[36];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0x2C; // command, 0x2C for get output name

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 36, remote_ip);
    if(recv_count == 36)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0x2D)
        {
            memcpy(name, recv_data + 4, 32);
            result = true;
        }
    }
    return result;
}

bool SDKSocket::reboot(void)
{
    char send_data[4];
    char recv_data[4];
    char remote_ip[4];
    int recv_count;
    bool result = false;

    if(selected_show_bridge_index < 0) return false;

    send_data[0] = 0x44; // 'D'
    send_data[1] = 0x4D; // 'M'
    send_data[2] = 0x01; // version
    send_data[3] = 0xFE; // command, 0xFE for reboot

    udp_socket->set_time_out(100); // 100ms
    udp_socket->UDPSendTo(*reinterpret_cast<SocketLib::ipaddress*>(show_bridge_list[selected_show_bridge_index].ip), SERVER_PORT, send_data, 4);
    recv_count = udp_socket->UDPReceiveFrom(recv_data, 4, remote_ip);
    if(recv_count == 4)
    {
        if(recv_data[0] == 'D' && recv_data[1] == 'M' && recv_data[2] == 0x01 && recv_data[3] == 0xFF)
        {
            result = true;
        }
    }
    return result;
}



#pragma pack(pop)
#pragma pack(pop)
