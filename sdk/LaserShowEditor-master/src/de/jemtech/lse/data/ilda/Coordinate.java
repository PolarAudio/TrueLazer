package de.jemtech.lse.data.ilda;

import java.awt.Color;

public class Coordinate {
	private int x;
	private int y;
	private int z;
	private int r;
	private int g;
	private int b;
	
	public boolean isBlank(){
		return r==0 && b == 0 && g==0;
	}
	
	public void setColor(Color color){
		setRed(color.getRed());
		setGreen(color.getGreen());
		setBlue(color.getBlue());
	}
	
	public int getRed(){
		return r;
	}
	
	public int getGreen(){
		return g;
	}
	
	public int getBlue(){
		return b;
	}
	
	public int getX(){
		return x;
	}
	
	public int getY(){
		return y;
	}
	
	public int getZ(){
		return z;
	}

	public void setX(int x) {
		if(x>32767){
			x=32767;
		}else if(x<-32768){
			x=-32768;
		}
		this.x = x;
	}

	public void setY(int y) {
		if(y>32767){
			y=32767;
		}else if(y<-32768){
			y=-32768;
		}
		this.y = y;
	}

	public void setRed(int r) {
		this.r = r;
	}
	
	public void setGreen(int g) {
		this.g = g;
	}
	
	public void setBlue(int b) {
		this.b = b;
	}
	
	public void setZ(int z) {
		if(z>32767){
			z=32767;
		}else if(z<-32768){
			z=-32768;
		}
		this.z = z;
	}
	
	public Coordinate clone(){
		Coordinate clone = new Coordinate();
		clone.b = b;
		clone.g = g;
		clone.r = r;
		clone.x = x;
		clone.y = y;
		clone.z = z;
		return clone;
	}
}
