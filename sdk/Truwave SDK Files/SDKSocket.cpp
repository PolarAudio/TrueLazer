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
    if(!IsLittleEnd) s = Swap(value);
    memcpy(buffer, &s, sizeof(short)); 
}

void GetShort(short &value, void *buffer)
{
    char buf[sizeof(short)];
    memcpy(buf, buffer, sizeof(short));
    if(!IsLittleEnd) Swap(buf, sizeof(short));
    memcpy(&value, buf, sizeof(short));
}

void PutFloat(float &value, void *buffer)
{
    float s = value;
    if(!IsLittleEnd) s = Swap(s);
    memcpy(buffer, &s, sizeof(float)); 
}

void GetFloat(float &value, void *buffer)
{
    char buf[sizeof(short)];
    memcpy(buf, buffer, sizeof(float));
    if(!IsLittleEnd) Swap(buf, sizeof(float));
    memcpy(&value, buf, sizeof(float));
}

