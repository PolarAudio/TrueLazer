#ifndef WINSOCK_INCLUDES_H
#define WINSOCK_INCLUDES_H

#ifdef _WIN32
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <Ws2tcpip.h>
#endif

#endif // WINSOCK_INCLUDES_H