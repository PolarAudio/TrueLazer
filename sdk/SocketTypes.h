// This File contains all of the basic types


#ifndef SOCKETTYPES_H
#define SOCKETTYPES_H

// ========================================================================
//  Include Files
// ========================================================================
#ifdef _WIN32                // windows 95 and above
    #include "WinsockIncludes.h"
    #ifndef socklen_t
        typedef int socklen_t;
    #endif

#else                       // UNIX/Linux
    #include <sys/types.h>      // header containing all basic data types and
                                // typedefs
    #include <sys/socket.h>     // header containing socket data types and
                                // functions
    #include <netinet/in.h>     // IPv4 and IPv6 stuff
    #include <unistd.h>         // for gethostname()
    #include <netdb.h>          // for DNS - gethostbyname()
    #include <arpa/inet.h>      // contains all inet_* functions
    #include <errno.h>          // contains the error functions
    #include <fcntl.h>          // file control
#endif



namespace SocketLib
{
    // ========================================================================
    //  Globals and Typedefs
    // ========================================================================
    #ifdef _WIN32                // windows 95 and above
        typedef SOCKET sock;
    #else                       // UNIX/Linux
        typedef int sock;
    #endif

    // ========================================================================
    //  Ports will be in host byte order, but IP addresses in network byte 
    //  order. It's easier this way; ports are usually accessed as numbers,
    //  but IP addresses are better accessed through the string functions.
    // ========================================================================
    typedef unsigned short int port;        // define the port type.
    typedef unsigned long int ipaddress;    // an IP address for IPv4


}   // end namespace SocketLib


#endif
