package de.jemtech.lse.data.ilda;

import java.util.LinkedList;
import java.util.List;

public class Frame {
	private List<Coordinate> coordinates = new LinkedList<Coordinate>();
	public List<Coordinate> getCoordinates(){
		return coordinates;
	}

	String name = "";
	String companyName = "";
	int scannerHead;
	
	public Frame clone(){
		Frame clone = new Frame();
		clone.companyName = companyName;
		clone.name = name;
		clone.scannerHead = scannerHead;
		for(Coordinate coordinate : coordinates){
			clone.coordinates.add(coordinate.clone());
		}
		return clone;
	}
}
