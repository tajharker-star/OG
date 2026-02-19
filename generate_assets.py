import wave
import math
import struct
import random
import os

AUDIO_DIR = "client/public/assets/audio"
os.makedirs(AUDIO_DIR, exist_ok=True)

def write_wav(filename, data, sample_rate=44100):
    with wave.open(os.path.join(AUDIO_DIR, filename), 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        f.writeframes(data)
    print(f"Generated {filename}")

def generate_shoot():
    # Short noise burst with decay
    duration = 0.2
    sample_rate = 44100
    n_samples = int(duration * sample_rate)
    data = bytearray()
    
    for i in range(n_samples):
        t = i / sample_rate
        # Envelope: Fast attack, exponential decay
        envelope = math.exp(-t * 20)
        # Noise
        value = (random.random() * 2 - 1) * envelope * 0.5
        
        # Clip and convert to 16-bit PCM
        packed = struct.pack('<h', int(max(-32767, min(32767, value * 32767))))
        data.extend(packed)
        
    write_wav("shoot.wav", data)

def generate_explosion():
    # Longer noise with heavier decay and some low freq modulation
    duration = 0.8
    sample_rate = 44100
    n_samples = int(duration * sample_rate)
    data = bytearray()
    
    last_val = 0
    for i in range(n_samples):
        t = i / sample_rate
        envelope = math.exp(-t * 5)
        
        # Simple low-pass filter (moving average)
        raw_noise = (random.random() * 2 - 1)
        value = (last_val + raw_noise) / 2
        last_val = value
        
        final_val = value * envelope * 0.8
        data.extend(struct.pack('<h', int(max(-32767, min(32767, final_val * 32767)))))
        
    write_wav("explosion.wav", data)

def generate_recruit():
    # Ascending major triad (C E G)
    duration = 0.5
    sample_rate = 44100
    n_samples = int(duration * sample_rate)
    data = bytearray()
    
    freqs = [440, 554, 659] # A Majorish
    
    for i in range(n_samples):
        t = i / sample_rate
        val = 0
        
        # Mix frequencies
        for f in freqs:
            val += math.sin(2 * math.pi * f * t)
            
        val /= 3 # Normalize
        
        # Envelope: Fade in/out
        if t < 0.1:
            envelope = t / 0.1
        elif t > 0.4:
            envelope = (0.5 - t) / 0.1
        else:
            envelope = 1.0
            
        final_val = val * envelope * 0.5
        data.extend(struct.pack('<h', int(max(-32767, min(32767, final_val * 32767)))))
        
    write_wav("recruit.wav", data)

def generate_move_land():
    # Short low thud/crunch
    duration = 0.15
    sample_rate = 44100
    n_samples = int(duration * sample_rate)
    data = bytearray()
    
    for i in range(n_samples):
        t = i / sample_rate
        # Low sine + noise
        sine = math.sin(2 * math.pi * 80 * t)
        noise = (random.random() * 2 - 1)
        
        val = (sine * 0.6 + noise * 0.4)
        envelope = math.exp(-t * 25)
        
        final_val = val * envelope * 0.4
        data.extend(struct.pack('<h', int(max(-32767, min(32767, final_val * 32767)))))
        
    write_wav("move_land.wav", data)

def generate_move_water():
    # Swishing noise
    duration = 0.3
    sample_rate = 44100
    n_samples = int(duration * sample_rate)
    data = bytearray()
    
    last_val = 0
    for i in range(n_samples):
        t = i / sample_rate
        # Band-passish noise
        raw = (random.random() * 2 - 1)
        val = (last_val * 0.9 + raw * 0.1) # Strong low pass
        last_val = val
        
        # Sine modulation for "swish"
        mod = 0.5 + 0.5 * math.sin(2 * math.pi * 5 * t)
        
        envelope = math.sin(math.pi * (t / duration)) # Bell curve
        
        final_val = val * mod * envelope * 2.0 # Boost quiet signal
        data.extend(struct.pack('<h', int(max(-32767, min(32767, final_val * 32767)))))
        
    write_wav("move_water.wav", data)

def generate_move_air():
    # Drone / Engine
    duration = 0.4
    sample_rate = 44100
    n_samples = int(duration * sample_rate)
    data = bytearray()
    
    phase = 0
    freq = 150
    
    for i in range(n_samples):
        t = i / sample_rate
        
        # Sawtooth-ish
        phase += freq / sample_rate
        if phase > 1: phase -= 1
        saw = (phase * 2 - 1)
        
        # Sine sub
        sine = math.sin(2 * math.pi * (freq/2) * t)
        
        val = saw * 0.3 + sine * 0.5
        
        # Envelope (loopable-ish, but fade edges)
        envelope = 1.0
        if t < 0.05: envelope = t / 0.05
        if t > 0.35: envelope = (0.4 - t) / 0.05
        
        final_val = val * envelope * 0.3
        data.extend(struct.pack('<h', int(max(-32767, min(32767, final_val * 32767)))))
        
    write_wav("move_air.wav", data)

def generate_music():
    # Simple Techno Loop (130 BPM)
    bpm = 130
    beat_dur = 60 / bpm
    bar_dur = beat_dur * 4
    total_dur = bar_dur * 4 # 4 bars
    
    sample_rate = 44100
    n_samples = int(total_dur * sample_rate)
    data = bytearray()
    
    # Track state
    kick_phase = 0
    hat_phase = 0
    bass_phase = 0
    
    for i in range(n_samples):
        t = i / sample_rate
        beat_time = t % beat_dur
        bar_time = t % bar_dur
        
        val = 0
        
        # Kick (Every beat)
        if beat_time < 0.15:
            kt = beat_time
            k_env = math.exp(-kt * 20)
            k_freq = 150 * math.exp(-kt * 30)
            val += math.sin(2 * math.pi * k_freq * kt) * k_env * 0.8
            
        # Hi-hat (Every off-beat)
        if beat_time > beat_dur/2 and beat_time < beat_dur/2 + 0.1:
            ht = beat_time - beat_dur/2
            h_env = math.exp(-ht * 50)
            h_noise = (random.random() * 2 - 1)
            val += h_noise * h_env * 0.3
            
        # Bass (Off-beat pulse)
        if beat_time > beat_dur/2:
            bt = beat_time - beat_dur/2
            b_freq = 55 # A1
            if (t // bar_dur) % 2 == 1: b_freq = 41.2 # E1
            
            b_val = math.sin(2 * math.pi * b_freq * t)
            # Sawtooth-ish
            b_val = (b_val > 0) * 1.0 - 0.5
            
            b_env = 1.0 - (bt / (beat_dur/2))
            val += b_val * b_env * 0.4
            
        # Lead (Arpeggio)
        sixteenth = beat_dur / 4
        step = int((t % bar_dur) / sixteenth)
        notes = [440, 554, 659, 880, 659, 554, 440, 329] * 2
        note = notes[step % len(notes)]
        
        l_t = t % sixteenth
        l_env = math.exp(-l_t * 10)
        val += math.sin(2 * math.pi * note * t) * l_env * 0.15

        # Clip
        data.extend(struct.pack('<h', int(max(-32767, min(32767, val * 32767)))))
        
    write_wav("defcat_main_menu.mp3", data) # Naming it .mp3 but it's WAV content

if __name__ == "__main__":
    generate_shoot()
    generate_explosion()
    generate_recruit()
    generate_move_land()
    generate_move_water()
    generate_move_air()
    generate_music()
