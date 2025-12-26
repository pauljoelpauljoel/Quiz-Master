class GameState {
    constructor() {
        this.games = {}; // Map PIN -> Game Object
        this.players = {}; // Map SocketID -> { name, pin, score }
    }

    createGame(hostSocketId, questions) {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        this.games[pin] = {
            host: hostSocketId,
            pin: pin,
            players: {},
            questions: questions || [], // Store questions here
            status: 'lobby', // lobby, playing, finished
            currentQuestionIndex: -1,
            questionStartTime: null,
            answers: {} // Map questionIndex -> { playerId: { answer, timeTaken, score } }
        };
        return pin;
    }

    addPlayer(pin, name, socketId) {
        const game = this.games[pin];
        if (!game) return { error: "Game not found" };
        if (game.status !== 'lobby') return { error: "Game already started" };





        // Check if name exists
        const existingPlayer = Object.values(game.players).find(p => p.name === name);
        if (existingPlayer) return { error: "Name taken" };

        game.players[socketId] = {
            id: socketId,
            name: name,
            score: 0,
            streak: 0
        };
        this.players[socketId] = { pin, name }; // Quick lookup
        return { success: true, game };
    }

    getGameByPin(pin) {
        return this.games[pin];
    }

    getGameByHost(socketId) {
        return Object.values(this.games).find(g => g.host === socketId);
    }

    getGameByPlayer(socketId) {
        const player = this.players[socketId];
        if (!player) return null;
        return this.games[player.pin];
    }

    removePlayer(socketId) {
        const player = this.players[socketId];
        if (player) {
            const game = this.games[player.pin];
            if (game) {
                delete game.players[socketId];
                // Clean up game if host leaves? Or just player?
                // logic for host leaving is handled separately
            }
            delete this.players[socketId];
            return { type: 'player', pin: player.pin, name: player.name };
        }

        // Check if it's a host
        const gameHosted = this.getGameByHost(socketId);
        if (gameHosted) {
            delete this.games[gameHosted.pin];
            return { type: 'host', pin: gameHosted.pin };
        }
        return null;
    }

    startGame(pin) {
        const game = this.games[pin];
        if (!game) return false;
        game.status = 'playing';
        game.currentQuestionIndex = -1;
        return true;
    }

    submitAnswer(socketId, answerIndex) {
        const game = this.getGameByPlayer(socketId);
        if (!game || game.status !== 'playing') return null;

        const questionIndex = game.currentQuestionIndex;

        // Initialize answer storage for this question if needed
        if (!game.answers[questionIndex]) {
            game.answers[questionIndex] = {};
        }

        // Prevent multiple answers
        if (game.answers[questionIndex][socketId]) return null;

        const timeTaken = (Date.now() - game.questionStartTime) / 1000;
        game.answers[questionIndex][socketId] = {
            answer: answerIndex,
            timeTaken: timeTaken
        };

        return game;
    }
}

module.exports = new GameState();
