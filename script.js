const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const messageElement = document.getElementById('message');

// Game constants (Relative to height)
let GRAVITY = 0;
let FLAP_STRENGTH = 0;
let PIPE_SPEED = 0;
let PIPE_GAP = 0;
let PIPE_WIDTH = 0;
let BABY_WIDTH = 0;
let BABY_HEIGHT = 0;

const SPAWN_RATE = 100;

// Assets
const babyUpImg = new Image();
babyUpImg.src = 'assets/baby_up.png';
const babyDownImg = new Image();
babyDownImg.src = 'assets/baby_down.png';
const babyCryImg = new Image();
babyCryImg.src = 'assets/baby_cry.png';
const bottleImg = new Image();
bottleImg.src = 'assets/baby_bottle.png';
const bgImg = new Image();
bgImg.src = 'assets/city.png';

let gameRunning = false;
let frames = 0;
let score = 0;
let pipes = [];

// Screen State
let originalHeight = 900; // Reference height for physics tuning
let BABY_SCALE = 1;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Disable smoothing for crisp pixel art
    ctx.imageSmoothingEnabled = false;

    // Recalculate constants based on height
    const ratio = canvas.height / originalHeight;

    GRAVITY = 0.4 * ratio;
    FLAP_STRENGTH = -8 * ratio;
    PIPE_SPEED = 4 * ratio;
    if (PIPE_SPEED < 2) PIPE_SPEED = 2;

    PIPE_GAP = canvas.height * 0.25;
    PIPE_WIDTH = canvas.width * 0.15;
    if (PIPE_WIDTH > 80) PIPE_WIDTH = 80;

    // Calculate Scale based on Neutral Pose (babyDown)
    // Target height for the neutral baby is approx 7% of screen
    let targetNeutralHeight = canvas.height * 0.07;

    if (babyDownImg.complete && babyDownImg.naturalHeight > 0) {
        BABY_SCALE = targetNeutralHeight / babyDownImg.naturalHeight;
    } else {
        BABY_SCALE = targetNeutralHeight / 32; // Fallback guess
    }

    if (!gameRunning) {
        drawStartScreen();
    }
}
window.addEventListener('resize', resize);
// Also resize when images load to ensure correct scale
babyDownImg.onload = resize;

const baby = {
    x: 0, // Set in reset
    y: 0,
    velocity: 0,
    rotation: 0,
    w: 0,
    h: 0,
    crashed: false,

    draw: function () {
        let img;
        if (this.crashed) {
            img = babyCryImg;
        } else {
            img = this.velocity < 0 ? babyUpImg : babyDownImg;
        }

        if (!img.complete || img.naturalWidth === 0) return; // Wait for load

        ctx.save();
        ctx.translate(this.x, this.y);

        // Recalculate scale just in case (e.g. if loaded after resize)
        let targetNeutralHeight = canvas.height * 0.07;
        if (babyDownImg.complete && babyDownImg.naturalHeight > 0) {
            BABY_SCALE = targetNeutralHeight / babyDownImg.naturalHeight;
        }

        // Calculate dimensions for THIS sprite
        let currentScale = BABY_SCALE;

        // Fix for crying baby being potentially larger/smaller
        // We want it to be roughly the same height as the neutral pose on screen
        if (this.crashed && img.naturalHeight > 0) {
            // Use local scale to match target height
            currentScale = targetNeutralHeight / img.naturalHeight;
        }

        this.w = img.naturalWidth * currentScale;
        this.h = img.naturalHeight * currentScale;

        // Don't rotate if crashed, just fall straight or stay put? 
        // Flappy bird usually rotates nose down on crash. 
        // Let's keep rotation but maybe cap it?

        let targetRotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (this.velocity * 0.1)));
        if (!this.crashed) {
            this.rotation += (targetRotation - this.rotation) * 0.1;
        } else {
            // Spin or faceplant? Let's just faceplant
            this.rotation = Math.PI / 2;
        }

        ctx.rotate(this.rotation);

        // Draw image fit to dimensions
        // The images are cropped differently, but we draw inside the box
        ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);

        ctx.restore();
    },

    update: function () {
        this.velocity += GRAVITY;
        this.y += this.velocity;

        // Use current dimensions for collision bounds
        let halfH = this.h / 2 || 15;

        // Floor collision
        if (this.y + halfH >= canvas.height - 20) {
            this.y = canvas.height - 20 - halfH;
            if (!this.crashed) gameOver(); // Trigger game over if not already
            this.velocity = 0; // Stop moving on floor
        }

        // Ceiling collision
        if (this.y - halfH <= 0) {
            this.y = halfH;
            this.velocity = 0;
        }
    },

    flap: function () {
        if (!this.crashed) this.velocity = FLAP_STRENGTH;
    },

    reset: function () {
        this.x = canvas.width / 4;
        this.y = canvas.height / 2;
        this.velocity = 0;
        this.rotation = 0;
        this.crashed = false;
    }
};

const background = {
    x: 0,
    draw: function () {
        // Look: Simple Blue Sky
        let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, "#70c5ce");
        grad.addColorStop(1, "#ccebf4"); // lighter at bottom
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    },
    update: function () {
        // No scrolling background anymore
    }
};

const nippleImg = new Image();
nippleImg.src = 'assets/nipple.png';
const bodyTileImg = new Image();
bodyTileImg.src = 'assets/body_tile.png';

// ... (existing code) ...

class Pipe {
    constructor() {
        this.x = canvas.width;
        this.w = PIPE_WIDTH;

        // Ensure pipe width is compatible with aspect ratio? 
        // We stretch anyway.

        let minPipe = canvas.height * 0.1;
        let maxPipe = canvas.height - PIPE_GAP - minPipe - 50;

        this.topHeight = Math.floor(Math.random() * (maxPipe - minPipe + 1)) + minPipe;
        this.bottomY = this.topHeight + PIPE_GAP;
        this.passed = false;
    }

    draw() {
        if (!nippleImg.complete || !bodyTileImg.complete || nippleImg.naturalWidth === 0) {
            ctx.fillStyle = '#73bf2e';
            ctx.fillRect(this.x, 0, this.w, this.topHeight);
            ctx.fillRect(this.x, this.bottomY, this.w, canvas.height - this.bottomY - 20);
            return;
        }

        ctx.save();

        // Calculate Nipple Height maintaining aspect ratio relative to PIPE WIDTH
        let scale = this.w / nippleImg.naturalWidth;
        let nippleH = nippleImg.naturalHeight * scale;

        // --- Top Pipe (Inverted Bottle) ---
        // Nipple tip is at this.topHeight
        // Nipple base is at this.topHeight - nippleH
        // Body is from 0 to topHeight - nippleH

        let topBodyH = this.topHeight - nippleH;

        // Draw Body (from 0 to topBodyH)
        if (topBodyH > 0) {
            ctx.drawImage(bodyTileImg, this.x, 0, this.w, topBodyH);
        }

        // Draw Inverted Nipple
        // Translate to the tip of nipple (bottom visually)
        ctx.save();
        ctx.translate(this.x + this.w, this.topHeight);
        ctx.rotate(Math.PI);
        ctx.drawImage(nippleImg, 0, 0, this.w, nippleH);
        ctx.restore();


        // --- Bottom Pipe (Upright Bottle) ---
        // Nipple tip is at this.bottomY
        // Nipple base is at this.bottomY + nippleH? 
        // No, nipple tip is pointing UP. So the base is at bottomY + nippleH.
        // The tip is at bottomY.

        // Draw Nipple
        ctx.drawImage(nippleImg, this.x, this.bottomY, this.w, nippleH);

        // Draw Body (from bottomY + nippleH to ground)
        let bodyY = this.bottomY + nippleH;
        let bodyH = canvas.height - bodyY - 20;
        if (bodyH > 0) {
            ctx.drawImage(bodyTileImg, this.x, bodyY, this.w, bodyH);
        }

        ctx.restore();
    }

    update() {
        this.x -= PIPE_SPEED;

        // Collision
        let bw = (baby.w || 30) * 0.7;
        let bh = (baby.h || 30) * 0.7;
        let bx = baby.x - bw / 2;
        let by = baby.y - bh / 2;

        if (bx + bw > this.x && bx < this.x + this.w) {
            if (by < this.topHeight || by + bh > this.bottomY) {
                gameOver();
            }
        }

        if (bx > this.x + this.w && !this.passed) {
            score++;
            scoreElement.innerText = score;
            this.passed = true;
        }
    }
}

function init() {
    resize();
    gameRunning = false;
    score = 0;
    frames = 0;
    pipes = [];
    baby.reset();
    scoreElement.innerText = score;
    messageElement.style.display = 'block';
    messageElement.innerText = "Tap or Press Space to Start";

    drawStartScreen();
}

function drawStartScreen() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    background.draw();
    baby.draw();
    // Ground
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
    ctx.strokeStyle = '#cbb968';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 20);
    ctx.lineTo(canvas.width, canvas.height - 20);
    ctx.stroke();
}

function loop() {
    if (!gameRunning) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    background.update();
    background.draw();

    // Pipes
    if (frames % SPAWN_RATE === 0) {
        pipes.push(new Pipe());
    }

    for (let i = 0; i < pipes.length; i++) {
        pipes[i].update();
        pipes[i].draw();

        if (pipes[i].x + pipes[i].w < -50) {
            pipes.splice(i, 1);
            i--;
        }
    }

    // Ground
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
    ctx.strokeStyle = '#cbb968';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 20);
    ctx.lineTo(canvas.width, canvas.height - 20);
    ctx.stroke();

    // Baby
    baby.update();
    baby.draw();

    frames++;
    requestAnimationFrame(loop);
}

function gameOver() {
    gameRunning = false;
    baby.crashed = true;
    messageElement.innerText = "Game Over!\nTap to Restart";
    messageElement.style.display = 'block';
    // Force one last draw to show crashed sprite
    baby.draw();
}

function startGame() {
    if (gameRunning) return;

    if (messageElement.innerText.includes("Game Over")) {
        // Reset everything
        pipes = [];
        score = 0;
        scoreElement.innerText = 0;
        baby.reset();
        frames = 0;
        gameRunning = true;
        messageElement.style.display = 'none';
        loop();
    } else {
        gameRunning = true;
        messageElement.style.display = 'none';
        loop();
    }
}

// Input
window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
        if (!gameRunning) startGame();
        baby.flap();
    }
});

window.addEventListener('mousedown', function () {
    if (!gameRunning) startGame();
    baby.flap();
});
window.addEventListener('touchstart', function (e) {
    e.preventDefault(); // prevent scroll
    if (!gameRunning) startGame();
    baby.flap();
}, { passive: false });

// Start
window.onload = init;
