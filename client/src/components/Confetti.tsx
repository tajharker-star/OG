import React, { useEffect, useRef } from 'react';
import './Confetti.css';

export const Confetti: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles: any[] = [];
        const particleCount = 150;
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ffffff'];

        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                w: Math.random() * 10 + 5,
                h: Math.random() * 10 + 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                speed: Math.random() * 3 + 2,
                angle: Math.random() * 360,
                spin: Math.random() < 0.5 ? -1 : 1
            });
        }

        let animationId: number;

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach(p => {
                p.y += p.speed;
                p.angle += p.spin;
                
                if (p.y > canvas.height) {
                    p.y = -20;
                    p.x = Math.random() * canvas.width;
                }

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.angle * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            });

            animationId = requestAnimationFrame(render);
        };

        render();

        return () => cancelAnimationFrame(animationId);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="confetti-canvas"
        />
    );
};
