def parse_ilda_file(file_path):
    with open(file_path, 'rb') as f:
        frames = []
        
        while True:
            # Read header
            header = f.read(32)
            if len(header) < 32:
                break
            
            # Parse header
            identifier = header[0:4].decode('ascii')
            if identifier != 'ILDA':
                raise ValueError("Not a valid ILDA file")
            
            format_code = header[7]
            frame_name = header[8:16].decode('ascii').strip()
            company_name = header[16:24].decode('ascii').strip()
            total_records = int.from_bytes(header[24:26], 'big')
            frame_number = int.from_bytes(header[26:28], 'big')
            total_frames = int.from_bytes(header[28:30], 'big')
            scanner_head = int.from_bytes(header[30:32], 'big')
            
            # Determine record size based on format
            record_sizes = {
                0: 8,  # 3D indexed color
                1: 6,  # 2D indexed color
                2: 4,  # Color palette
                4: 10, # 3D true color
                5: 8   # 2D true color
            }
            
            if format_code not in record_sizes:
                raise ValueError(f"Unsupported format code: {format_code}")
            
            record_size = record_sizes[format_code]
            records = []
            
            # Read all records in this frame
            for _ in range(total_records):
                record_data = f.read(record_size)
                if len(record_data) < record_size:
                    break
                
                # Parse based on format
                if format_code == 0:  # 3D indexed
                    x = int.from_bytes(record_data[0:2], 'big', signed=True)
                    y = int.from_bytes(record_data[2:4], 'big', signed=True)
                    z = int.from_bytes(record_data[4:6], 'big', signed=True)
                    status = record_data[6]
                    color_index = record_data[7]
                    records.append({
                        'x': x, 'y': y, 'z': z,
                        'blanking': (status & 0x01) != 0,
                        'last_point': (status & 0x02) != 0,
                        'color_index': color_index
                    })
                
                elif format_code == 1:  # 2D indexed
                    x = int.from_bytes(record_data[0:2], 'big', signed=True)
                    y = int.from_bytes(record_data[2:4], 'big', signed=True)
                    status = record_data[4]
                    color_index = record_data[5]
                    records.append({
                        'x': x, 'y': y, 'z': 0,
                        'blanking': (status & 0x01) != 0,
                        'last_point': (status & 0x02) != 0,
                        'color_index': color_index
                    })
                
                elif format_code == 2:  # Color palette
                    r = record_data[0]
                    g = record_data[1]
                    b = record_data[2]
                    records.append({'r': r, 'g': g, 'b': b})
                
                elif format_code == 4:  # 3D true color
                    x = int.from_bytes(record_data[0:2], 'big', signed=True)
                    y = int.from_bytes(record_data[2:4], 'big', signed=True)
                    z = int.from_bytes(record_data[4:6], 'big', signed=True)
                    status = record_data[6]
                    b = record_data[7]
                    g = record_data[8]
                    r = record_data[9]
                    records.append({
                        'x': x, 'y': y, 'z': z,
                        'blanking': (status & 0x01) != 0,
                        'last_point': (status & 0x02) != 0,
                        'r': r, 'g': g, 'b': b
                    })
                
                elif format_code == 5:  # 2D true color
                    x = int.from_bytes(record_data[0:2], 'big', signed=True)
                    y = int.from_bytes(record_data[2:4], 'big', signed=True)
                    status = record_data[4]
                    b = record_data[5]
                    g = record_data[6]
                    r = record_data[7]
                    records.append({
                        'x': x, 'y': y, 'z': 0,
                        'blanking': (status & 0x01) != 0,
                        'last_point': (status & 0x02) != 0,
                        'r': r, 'g': g, 'b': b
                    })
            
            frames.append({
                'format': format_code,
                'frame_name': frame_name,
                'company_name': company_name,
                'frame_number': frame_number,
                'total_frames': total_frames,
                'scanner_head': scanner_head,
                'records': records
            })
            
            # Check if this is the last frame
            if frame_number == total_frames:
                break
        
        return frames