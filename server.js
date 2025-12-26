const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const gameState = require('./gamestate');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Routes to serve specific HTML files
app.get('/host', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.get('/play', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

app.get('/create', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'create.html'));
});

app.get('/history', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // --- HOST EVENTS ---
    socket.on('createGame', (data) => {
        // Data MUST contain custom questions now
        const questions = (data && data.questions) ? data.questions : [];
        const pin = gameState.createGame(socket.id, questions);
        socket.join(pin);
        socket.emit('gameCreated', { pin });
        console.log(`Game created: ${pin} with ${questions.length} questions`);
    });

    socket.on('startGame', () => {
        const game = gameState.getGameByHost(socket.id);
        if (game) {
            gameState.startGame(game.pin);
            io.to(game.pin).emit('gameStarted');
            nextQuestion(game.pin);
        }
    });

    socket.on('nextQuestion', () => {
        const game = gameState.getGameByHost(socket.id);
        if (game) {
            nextQuestion(game.pin);
        }
    });

    // --- PLAYER EVENTS ---
    socket.on('joinGame', ({ pin, name }) => {
        const result = gameState.addPlayer(pin, name, socket.id);
        if (result.error) {
            socket.emit('error', result.error);
        } else {
            socket.join(pin);
            socket.emit('joined', { pin, name });
            io.to(pin).emit('playerListUpdate', Object.values(result.game.players));
        }
    });

    socket.on('submitAnswer', ({ answer }) => {
        const game = gameState.submitAnswer(socket.id, answer);
        if (game) {
            // Check if correct (for immediate feedback if we wanted, but we usually wait)
            // But we do need to calculate score eventually.
            // For now just ack that we got it.
            socket.emit('answerReceived');

            // Host update could happen here if we want to show "3/10 answered"
            const questionIdx = game.currentQuestionIndex;
            const answersCount = Object.keys(game.answers[questionIdx]).length;
            const playersCount = Object.keys(game.players).length;

            io.to(game.host).emit('answersUpdate', { count: answersCount, total: playersCount });

            // If everyone answered, maybe auto-finish? 
            if (answersCount === playersCount) {
                finishQuestion(game.pin);
            }
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const result = gameState.removePlayer(socket.id);
        if (result) {
            if (result.type === 'player') {
                io.to(result.pin).emit('playerLeft', result.name);
                // Update host list
                const game = gameState.getGameByPin(result.pin);
                if (game) {
                    io.to(result.pin).emit('playerListUpdate', Object.values(game.players));
                }
            } else if (result.type === 'host') {
                io.to(result.pin).emit('hostDisconnected');
            }
        }
    });

    // --- GAME LOGIC HELPERS ---
    function nextQuestion(pin) {
        const game = gameState.getGameByPin(pin);
        if (!game) return;

        game.currentQuestionIndex++;

        if (game.currentQuestionIndex >= game.questions.length) {
            // End Game
            game.status = 'finished';
            const leaderboard = calculateLeaderboard(game);
            io.to(pin).emit('gameOver', leaderboard);
            return;
        }

        const questionData = game.questions[game.currentQuestionIndex];
        game.questionStartTime = Date.now();

        // Send question to everyone (hide correct answer)
        io.to(pin).emit('newQuestion', {
            question: questionData.question,
            image: questionData.image, // Send image if exists
            options: questionData.options,
            time: questionData.time,
            number: game.currentQuestionIndex + 1,
            total: game.questions.length
        });

        // Start server timer (add 1s buffer)
        setTimeout(() => {
            // Check if we are still on the same question
            if (game.currentQuestionIndex === game.questions.indexOf(questionData)) {
                finishQuestion(pin);
            }
        }, (questionData.time + 1) * 1000);
    }

    function finishQuestion(pin) {
        const game = gameState.getGameByPin(pin);
        if (!game) return;

        // If already showing results for this q, skip
        // (This simple check prevents double-call from timeout + all-answered)
        if (game.showingResults) return; // Need a flag? 
        // Or just check if we are in 'playing' vs 'results' state?
        // Let's rely on emitting 'questionResult' which clients handle.

        const questionIdx = game.currentQuestionIndex;
        const correctAns = game.questions[questionIdx].answer;

        // Calculate scores for this round
        const roundAnswers = game.answers[questionIdx] || {};

        for (const [playerId, data] of Object.entries(roundAnswers)) {
            const player = game.players[playerId];
            if (player && parseInt(data.answer) === parseInt(correctAns)) {
                // Base score only (no time bonus)
                const basePoints = game.questions[questionIdx].points || 1;
                const points = basePoints;

                player.score += points;
                player.streak++;
                player.lastPoints = points;

                // Track total time for tie-breaker
                player.totalTimeTaken = (player.totalTimeTaken || 0) + data.timeTaken;
            } else if (player) {
                player.streak = 0;
                player.lastPoints = 0;
            }
        }

        const leaderboard = calculateLeaderboard(game);

        io.to(pin).emit('questionResult', {
            correctAnswer: correctAns,
            leaderboard: leaderboard.slice(0, 5) // Top 5
        });
    }

    function calculateLeaderboard(game) {
        return Object.values(game.players)
            .sort((a, b) => {
                // Primary: Score (Desc)
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                // Secondary: Total Time (Asc) - Faster is better
                return (a.totalTimeTaken || 0) - (b.totalTimeTaken || 0);
            });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
