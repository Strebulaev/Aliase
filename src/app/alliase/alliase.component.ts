import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Peer, DataConnection } from 'peerjs';
import { HttpClient } from '@angular/common/http';
import { unusedWords } from './unused-words';

interface Player {
    id: string;
    name: string;
    team: number;
    peerId: string;
    isLocal: boolean;
}

interface GameSettings {
    roundTime: number;
    totalRounds: number;
    maxWordLength: number;
    teamsCount: number;
    skipPenalty: number;
}

interface GameState {
    currentRound: number;
    currentPlayerIndex: number;
    currentWord: string;
    scores: number[];
    usedWords: { word: string, guessed: boolean, team: number }[];
    isGameStarted: boolean;
    isGameFinished: boolean;
    isBetweenRounds: boolean;
}

@Component({
    selector: 'app-alliase',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './alliase.component.html',
    styleUrls: ['./alliase.component.css']
})
export class AlliaseComponent implements OnInit, OnDestroy {
    gameSettings: GameSettings = {
        roundTime: 60,
        totalRounds: 3,
        maxWordLength: 2,
        teamsCount: 2,
        skipPenalty: 0
    };

    players: Player[] = [];
    gameState: GameState = {
        currentRound: 1,
        currentPlayerIndex: 0,
        currentWord: '',
        scores: [],
        usedWords: [],
        isGameStarted: false,
        isGameFinished: false,
        isBetweenRounds: false
    };

    peer: Peer | null = null;
    conn: DataConnection | null = null;
    peerId = '';
    friendPeerId = '';
    connectionStatus = 'Инициализация...';
    isConnected = false;
    isMainHost = false;

    newPlayerName = '';
    showConnectionPanel = true;
    showPlayerForm = false;
    isMobile = false;
    currentPlayer: Player | null = null;
    nextPlayer: Player | null = null;
    isCurrentTurnHost = false;

    private gameTimer: any;
    private syncTimer: any;
    timeLeft = 0;
    private lastUpdateTime = 0;
    private lastSyncTime = 0;

    private allWords: string[] = [];
    private wordBank: string[] = [...unusedWords];

    constructor(private http: HttpClient) {
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    async ngOnInit() {
        this.checkMobile();
        await this.initPeerConnection();
        this.setupConnectionWatchdog();
    }

    ngOnDestroy() {
        this.cleanup();
    }

    private cleanup() {
        this.clearTimers();
        if (this.peer) this.peer.destroy();
        if (this.conn) this.conn.close();
    }

    private async initPeerConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.peer) {
                this.peer.destroy();
            }

            const peerIdPrefix = `alias-${Date.now().toString(36).slice(-6)}`;

            this.peer = new Peer(peerIdPrefix, {
                debug: 2,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                this.peerId = id;
                this.connectionStatus = 'Готов к подключению';
                this.setupPeerListeners();
                resolve();
            });

            this.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                this.connectionStatus = 'Ошибка подключения: ' + err.message;
                reject(err);
            });
        });
    }

    private setupPeerListeners() {
        if (!this.peer) return;

        this.peer.on('connection', (conn) => {
            this.conn = conn;
            this.setupConnection();
            this.isMainHost = true;
            this.syncInitialState();
        });
    }

    async connectToFriend(): Promise<boolean> {
        if (!this.friendPeerId) {
            alert('Введите ID друга');
            return false;
        }

        if (!this.peer) {
            alert('Соединение не инициализировано');
            return false;
        }

        if (this.friendPeerId === this.peerId) {
            this.connectionStatus = 'Нельзя подключиться к самому себе';
            return false;
        }

        this.connectionStatus = 'Подключение к другу...';

        return new Promise<boolean>((resolve) => {
            const connectionTimeout = setTimeout(() => {
                this.connectionStatus = 'Таймаут подключения. Проверьте ID и сеть';
                resolve(false);
            }, 15000);

            if (this.conn) {
                this.conn.close();
            }

            const conn = this.peer!.connect(this.friendPeerId, {
                reliable: true,
                serialization: 'json'
            });

            conn.on('open', () => {
                clearTimeout(connectionTimeout);
                this.conn = conn;
                this.setupConnection();
                this.connectionStatus = 'Подключено!';
                this.isConnected = true;
                
                if (!this.isMainHost) {
                    this.showConnectionPanel = false;
                } else {
                    this.syncInitialState();
                }
                
                resolve(true);
            });

            conn.on('error', (err) => {
                clearTimeout(connectionTimeout);
                console.error('Connection error:', err);
                this.connectionStatus = 'Ошибка подключения';
                resolve(false);
            });
        });
    }

    private setupConnection() {
        if (!this.conn) return;

        this.conn.on('data', (data: any) => {
            if (data.type === 'game-state') {
                this.applyGameState(data.state);
                if (this.isMainHost && !this.gameState.isGameStarted) {
                    this.showConnectionPanel = false;
                }
            }
        });

        this.conn.on('close', () => {
            this.connectionStatus = 'Соединение закрыто';
            this.isConnected = false;
        });

        this.conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.connectionStatus = 'Ошибка соединения';
            this.isConnected = false;
        });

        if (this.isMainHost) {
            this.syncGameState();
        }
    }

    private syncInitialState() {
        if (this.isMainHost && this.conn && this.conn.open) {
            this.syncGameState();
            this.showConnectionPanel = false;
        }
    }

    private setupConnectionWatchdog() {
        setInterval(() => {
            if (!this.peer || !this.peer.disconnected) return;
            this.peer.reconnect();
        }, 5000);
    }

    private updateTimer() {
        if (!this.gameState.isGameStarted || this.gameState.isBetweenRounds) return;

        const now = Date.now();
        const elapsed = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        if (this.isCurrentTurnHost) {
            this.timeLeft = Math.max(0, this.timeLeft - elapsed);
            if (this.timeLeft <= 0) {
                this.clearTimer();
                this.endPlayerTurn();
            }
        }
    }

    private startSyncTimer() {
        this.clearSyncTimer();
        this.syncTimer = setInterval(() => {
            if (this.isMainHost && this.isConnected) {
                this.syncGameState();
            }
        }, 1000);
    }

    showAddPlayerForm() {
        if (!this.players.some(p => p.peerId === this.peerId)) {
            this.showPlayerForm = true;
        }
    }

    addPlayer() {
        if (!this.newPlayerName.trim()) {
            alert('Введите имя игрока');
            return;
        }

        const team = this.players.length % this.gameSettings.teamsCount;
        const newPlayer: Player = {
            id: Date.now().toString(),
            name: this.newPlayerName.trim(),
            team,
            peerId: this.peerId,
            isLocal: true
        };

        this.players.push(newPlayer);
        this.newPlayerName = '';
        this.showPlayerForm = false;

        if (this.isMainHost) {
            this.syncGameState();
        }
    }

    removePlayer(playerId: string) {
        this.players = this.players.filter(p => p.id !== playerId);
        if (this.isMainHost) {
            this.syncGameState();
        }
    }

    startGame() {
        if (this.players.length < 2) {
            alert('Нужно минимум 2 игрока');
            return;
        }

        this.prepareWords();
        this.gameState = {
            currentRound: 1,
            currentPlayerIndex: 0,
            currentWord: '',
            scores: new Array(this.gameSettings.teamsCount).fill(0),
            usedWords: [],
            isGameStarted: true,
            isGameFinished: false,
            isBetweenRounds: false
        };

        this.startPlayerTurn();
        this.startSyncTimer();
    }

    private prepareWords() {
        const availableWords = [...this.wordBank]
            .filter(word => word.split(' ').length <= this.gameSettings.maxWordLength);

        this.allWords = [...new Set(availableWords)]
            .sort(() => Math.random() - 0.5)
            .slice(0, this.players.length * this.gameSettings.totalRounds * 10);
    }

    private getNextWord(): string {
        if (this.allWords.length === 0) {
            this.prepareWords();
        }
        return this.allWords.pop() || 'Слово не найдено';
    }

    startPlayerTurn() {
        this.currentPlayer = this.players[this.gameState.currentPlayerIndex];
        this.nextPlayer = this.players[(this.gameState.currentPlayerIndex + 1) % this.players.length];
        this.isCurrentTurnHost = this.currentPlayer.peerId === this.peerId;
        this.timeLeft = this.gameSettings.roundTime;
        this.lastUpdateTime = Date.now();
        this.gameState.currentWord = this.getNextWord();

        this.clearTimer();
        this.gameTimer = setInterval(() => this.updateTimer(), 100);
        this.syncGameState();
    }

    handleAnswer(isCorrect: boolean) {
        if (!this.currentPlayer || !this.isCurrentTurnHost) return;

        this.gameState.usedWords.push({
            word: this.gameState.currentWord,
            guessed: isCorrect,
            team: this.currentPlayer.team
        });

        if (isCorrect) {
            this.gameState.scores[this.currentPlayer.team]++;
        } else {
            this.gameState.scores[this.currentPlayer.team] -= this.gameSettings.skipPenalty;
        }

        this.gameState.currentWord = this.getNextWord();
        this.syncGameState();
    }

    endPlayerTurn() {
        this.clearTimer();
        this.gameState.isBetweenRounds = true;
        this.isCurrentTurnHost = false;
        this.syncGameState();

        // Проверка окончания всех раундов
        if (this.gameState.currentRound >= this.gameSettings.totalRounds && 
            this.gameState.currentPlayerIndex >= this.players.length - 1) {
            this.endGame();
        }
    }

    continueGame() {
        if (!this.canContinueGame()) return;

        this.gameState.isBetweenRounds = false;
        this.gameState.currentPlayerIndex++;

        if (this.gameState.currentPlayerIndex >= this.players.length) {
            this.gameState.currentPlayerIndex = 0;
            this.gameState.currentRound++;

            if (this.gameState.currentRound > this.gameSettings.totalRounds) {
                this.endGame();
                return;
            }
        }

        this.startPlayerTurn();
    }

    endGame() {
        this.clearTimer();
        this.clearSyncTimer();
        this.gameState.isGameFinished = true;
        this.gameState.isGameStarted = false;
        this.syncGameState();
    }

    restartGame() {
        this.gameState.isGameFinished = false;
        this.startGame();
    }

    private syncGameState() {
        if (!this.conn || !this.conn.open) return;

        try {
            this.conn.send({
                type: 'game-state',
                state: {
                    settings: this.gameSettings,
                    players: this.players,
                    gameState: this.gameState,
                    currentPlayer: this.currentPlayer,
                    nextPlayer: this.nextPlayer,
                    timeLeft: this.timeLeft
                }
            });
        } catch (err) {
            console.error('Ошибка синхронизации:', err);
        }
    }

    private applyGameState(state: any) {
        if (!state) return;

        const wasConnectionPanelVisible = this.showConnectionPanel;
        
        if (state.settings) this.gameSettings = { ...this.gameSettings, ...state.settings };
        if (state.players) this.players = [...state.players];
        if (state.gameState) this.gameState = { ...this.gameState, ...state.gameState };
        if (state.currentPlayer) this.currentPlayer = { ...state.currentPlayer };
        if (state.nextPlayer) this.nextPlayer = { ...state.nextPlayer };
        if (state.timeLeft) this.timeLeft = state.timeLeft;
        
        if (!this.isMainHost) {
            this.showConnectionPanel = false;
        } else {
            this.showConnectionPanel = wasConnectionPanelVisible;
        }
    }

    // Методы для работы с шаблоном
    shouldShowConnectionPanel(): boolean {
        return !this.gameState.isGameStarted && 
               !this.gameState.isGameFinished && 
               this.showConnectionPanel;
    }

    isConnectionError(): boolean {
        return this.connectionStatus.includes('Ошибка');
    }

    shouldShowSetupPanel(): boolean {
        return !this.gameState.isGameStarted && 
               !this.gameState.isGameFinished && 
               !this.showConnectionPanel &&
               (this.isMainHost || this.players.length > 0);
    }

    shouldShowAddPlayerButton(): boolean {
        return !this.showPlayerForm && !this.players.some(p => p.peerId === this.peerId);
    }

    getTeamsArray(): any[] {
        return new Array(this.gameSettings.teamsCount);
    }

    getPlayerDisplayName(player: Player): string {
        return `${player.name} ${player.peerId === this.peerId ? '(Вы)' : ''} ${this.isHostPlayer(player) ? '(Хост)' : ''}`;
    }

    canStartGame(): boolean {
        return this.isMainHost && !this.gameState.isGameStarted && this.players.length >= 2;
    }

    shouldShowGameScreen(): boolean {
        return this.gameState.isGameStarted && !this.gameState.isBetweenRounds && !this.gameState.isGameFinished;
    }

    getRoundInfo(): string {
        return `${this.gameState.currentRound}/${this.gameSettings.totalRounds}`;
    }

    getCurrentPlayerInfo(): string {
        return `${this.currentPlayer?.name}`;
    }

    isHostPlayer(player: Player | null): boolean {
        if (!player || this.players.length === 0) return false;
        return player.peerId === this.players[0].peerId;
    }

    isTimeLow(): boolean {
        return this.timeLeft <= 10;
    }

    getTimeLeft(): string {
        return this.timeLeft.toFixed(0);
    }

    getTimerWidth(): number {
        return (this.timeLeft / this.gameSettings.roundTime) * 100;
    }

    shouldShowBetweenTurnsScreen(): boolean {
        return this.gameState.isBetweenRounds && !this.gameState.isGameFinished;
    }

    getRecentUsedWords(): any[] {
        return this.gameState.usedWords.slice().reverse().slice(0, 10);
    }

    getContinueButtonText(): string {
        return 'Продолжить';
    }

    shouldShowResultsScreen(): boolean {
        return this.gameState.isGameFinished;
    }

    hasWinner(): boolean {
        return this.getWinnerTeam() !== null;
    }

    canContinueGame(): boolean {
        return this.nextPlayer?.peerId === this.peerId;
    }

    getCurrentTeamPlayers(teamIndex: number): Player[] {
        return this.players.filter(player => player.team === teamIndex);
    }

    getWinnerTeam(): number | null {
        if (!this.gameState.isGameFinished) return null;
        
        const maxScore = Math.max(...this.gameState.scores);
        const winningTeams = this.gameState.scores
            .map((score, index) => score === maxScore ? index : -1)
            .filter(index => index !== -1);

        return winningTeams.length === 1 ? winningTeams[0] : null;
    }

    @HostListener('window:resize')
    checkMobile() {
        this.isMobile = window.innerWidth < 768;
    }

    async copyToClipboard(text: string) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    }

    private clearTimer() {
        if (this.gameTimer) {
            clearInterval(this.gameTimer);
            this.gameTimer = null;
        }
    }

    private clearSyncTimer() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }

    private clearTimers() {
        this.clearTimer();
        this.clearSyncTimer();
    }
}