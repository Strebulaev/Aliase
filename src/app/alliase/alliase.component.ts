import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Peer, DataConnection } from 'peerjs';
import { HttpClient } from '@angular/common/http';
import { usedWords } from './used-words';
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
  // Таймеры и временные переменные
  private lastUpdateTime = 0;
  private serverTimeLeft = 0;
  private lastSyncTimeLeft = 0;
  private localTimeOffset = 0;
  private gameTimer: any;
  private syncTimer: any;
  private connectionRetries = 0;
  private maxConnectionRetries = 5;

  // Состояние игры
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

  // Настройки игры
  gameSettings: GameSettings = {
    roundTime: 60,
    totalRounds: 3,
    maxWordLength: 2,
    teamsCount: 2,
    skipPenalty: 0
  };

  // Подключение
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  peerId = '';
  friendPeerId = '';
  connectionStatus = 'Инициализация...';
  showConnectionPanel = true;
  showManualConnect = false;
  manualFriendId = '';

  // Игроки
  players: Player[] = [];
  newPlayerName = '';
  currentPlayer: Player | null = null;
  nextPlayer: Player | null = null;
  showPlayerForm = false;

  // UI состояния
  isMobile = false;
  isConnected = false;
  isMainHost = false;
  isCurrentTurnHost = false;

  // Слова
  private allWords: string[] = [];
  private wordBank: string[] = [...unusedWords];
  private wordHistory: string[] = [];
  private maxWordHistory = 100;

  constructor(private http: HttpClient) {}

  async ngOnInit() {
    this.checkMobile();
    await this.initPeerConnection();
    this.setupConnectionWatchdog();
  }

  @HostListener('window:resize', ['$event'])
  onResize() {
    this.checkMobile();
  }

  checkMobile() {
    this.isMobile = window.innerWidth < 768;
  }

  private setupConnectionWatchdog() {
    setInterval(() => {
      if (this.conn && !this.conn.open && this.isConnected) {
        this.connectionStatus = 'Потеряно соединение. Переподключение...';
        this.retryPeerConnection();
      }
    }, 5000);
  }

  public initPeerConnection(): Promise<void> {
    return new Promise((resolve) => {
      this.connectionStatus = 'Инициализация соединения...';
      
      if (this.peer) {
        this.peer.destroy();
      }

      this.peer = new Peer({
        debug: 2,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { 
              urls: 'turn:numb.viagenie.ca',
              credential: 'muazkh',
              username: 'webrtc@live.com'
            }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.connectionStatus = 'Готов к подключению';
        localStorage.setItem('aliasPeerId', id);
        resolve();
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
        this.handlePeerError(err);
        resolve();
      });

      const savedId = localStorage.getItem('aliasPeerId');
      if (savedId) {
        this.peerId = savedId;
      }
    });
  }

  private handleIncomingConnection(conn: DataConnection) {
    this.conn = conn;
    this.isMainHost = true;
    this.isConnected = true;
    this.connectionStatus = `Игрок ${conn.peer} подключен!`;
    this.showConnectionPanel = false;

    conn.on('data', (data: any) => {
      this.handleIncomingData(data);
    });

    conn.on('close', () => {
      this.handleConnectionClose();
    });

    this.syncGameState();
  }

  connectToFriend() {
    if (!this.friendPeerId) {
      alert('Введите ID друга');
      return;
    }

    if (!this.peer) {
      alert('Соединение не инициализировано');
      return;
    }

    this.connectionStatus = 'Подключение...';
    this.conn = this.peer.connect(this.friendPeerId, {
      reliable: true,
      serialization: 'json'
    });

    this.setupConnection();
  }

  private setupConnection() {
    if (!this.conn) return;

    const connectionTimeout = setTimeout(() => {
      if (!this.isConnected) {
        this.connectionStatus = 'Таймаут подключения';
        this.conn?.close();
      }
    }, 15000);

    this.conn.on('open', () => {
      clearTimeout(connectionTimeout);
      this.isConnected = true;
      this.connectionStatus = 'Подключено!';
      this.showConnectionPanel = false;
      this.syncGameState();
    });

    this.conn.on('error', (err) => {
      clearTimeout(connectionTimeout);
      console.error('Connection error:', err);
      this.connectionStatus = 'Ошибка подключения';
    });
  }

  private handleConnectionClose() {
    this.connectionStatus = 'Соединение закрыто';
    this.isConnected = false;
    if (this.gameState.isGameStarted && !this.gameState.isGameFinished) {
      alert('Соединение потеряно! Игра приостановлена.');
    }
  }

  private handlePeerError(err: any) {
    console.error('PeerJS Error:', err);
    
    switch (err.type) {
      case 'peer-unavailable':
        this.connectionStatus = 'Игрок недоступен';
        break;
      case 'network':
        this.connectionStatus = 'Ошибка сети';
        break;
      case 'disconnected':
        this.connectionStatus = 'Соединение разорвано';
        break;
      default:
        this.connectionStatus = `Ошибка: ${err.message || 'Неизвестная ошибка'}`;
    }
    
    this.showManualConnect = true;
  }

  private retryPeerConnection() {
    if (this.connectionRetries >= this.maxConnectionRetries) {
      this.connectionStatus = 'Не удалось подключиться';
      return;
    }

    this.connectionRetries++;
    setTimeout(() => {
      this.initPeerConnection();
    }, 3000);
  }

  // Методы для работы с игроками
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
    } else {
      this.sendPlayerUpdate('add', newPlayer);
    }
  }

  removePlayer(playerId: string) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    if (player.isLocal || this.isMainHost) {
      this.players = this.players.filter(p => p.id !== playerId);
      this.syncGameState();
    }
  }

  shouldShowAddPlayerButton(): boolean {
    return !this.showPlayerForm && 
           this.isConnected && 
           !this.players.some(p => p.peerId === this.peerId);
  }

  getCurrentTeamPlayers(teamIndex: number): Player[] {
    return this.players.filter(player => player.team === teamIndex);
  }

  // Методы игры
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
  }

  private prepareWords() {
    if (this.wordHistory.length > this.maxWordHistory) {
      this.wordHistory = this.wordHistory.slice(-this.maxWordHistory);
    }

    const availableWords = [...this.wordBank]
      .filter(word => !this.wordHistory.includes(word) && 
                     word.split(' ').length <= this.gameSettings.maxWordLength);

    this.allWords = [...new Set(availableWords)]
      .sort(() => Math.random() - 0.5)
      .slice(0, this.players.length * this.gameSettings.totalRounds * 10);

    this.wordHistory.push(...this.allWords);
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
    this.gameState.currentWord = this.getNextWord();

    this.clearTimer();
    this.startTimer();
    this.syncGameState();
  }

  private startTimer() {
    this.lastUpdateTime = Date.now();
    this.serverTimeLeft = this.timeLeft;

    this.gameTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = now;

      if (this.isCurrentTurnHost) {
        this.timeLeft = Math.max(0, this.timeLeft - elapsed);
        this.serverTimeLeft = this.timeLeft;

        if (now - this.lastSyncTime > 1000) {
          this.syncTime();
        }
      } else {
        this.timeLeft = Math.max(0, this.serverTimeLeft - (now - this.lastSyncTime) / 1000);
      }

      if (this.timeLeft <= 0) {
        this.clearTimer();
        if (this.isCurrentTurnHost) {
          this.endPlayerTurn();
        }
      }
    }, 100);
  }

  private syncTime() {
    if (!this.isCurrentTurnHost || !this.conn) return;

    this.lastSyncTime = Date.now();
    try {
      this.conn.send({
        type: 'timeSync',
        timeLeft: this.timeLeft,
        serverTime: Date.now()
      });
    } catch (err) {
      console.error('Ошибка синхронизации времени:', err);
    }
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
      this.gameState.scores[this.currentPlayer.team] = Math.max(0, 
        this.gameState.scores[this.currentPlayer.team] - this.gameSettings.skipPenalty);
    }

    this.gameState.currentWord = this.getNextWord();
    this.syncGameState();
  }

  endPlayerTurn() {
    this.clearTimer();
    this.gameState.isBetweenRounds = true;
    this.isCurrentTurnHost = false;
    this.syncGameState();
  }

  canContinueGame(): boolean {
    if (!this.nextPlayer) return false;
    return this.nextPlayer.peerId === this.peerId || this.isMainHost;
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
    this.gameState.isGameFinished = true;
    this.gameState.isGameStarted = false;
    this.syncGameState();
  }

  restartGame() {
    this.gameState.isGameFinished = false;
    this.startGame();
  }

  getWinnerTeam(): number | null {
    if (!this.gameState.isGameFinished) return null;

    const maxScore = Math.max(...this.gameState.scores);
    const winningTeams = this.gameState.scores
      .map((score, index) => score === maxScore ? index : -1)
      .filter(index => index !== -1);

    return winningTeams.length === 1 ? winningTeams[0] : null;
  }

  // Синхронизация состояния
  private syncGameState() {
    if (!this.conn || !this.conn.open) return;

    try {
      this.conn.send({
        type: 'gameState',
        state: {
          settings: this.gameSettings,
          players: this.players,
          gameState: this.gameState,
          currentPlayer: this.currentPlayer,
          nextPlayer: this.nextPlayer,
          timeLeft: this.timeLeft,
          isMainHost: this.isMainHost
        }
      });
    } catch (err) {
      console.error('Ошибка синхронизации:', err);
    }
  }

  private handleIncomingData(data: any) {
    if (!data) return;

    switch (data.type) {
      case 'gameState':
        this.applyGameState(data.state);
        break;
      case 'timeSync':
        this.handleTimeSync(data);
        break;
      case 'playerUpdate':
        this.handlePlayerUpdate(data);
        break;
    }
  }

  private applyGameState(state: any) {
    if (!state) return;

    if (state.settings) this.gameSettings = { ...this.gameSettings, ...state.settings };
    if (state.players) this.players = [...state.players];
    if (state.gameState) this.gameState = { ...this.gameState, ...state.gameState };
    if (state.currentPlayer) this.currentPlayer = { ...state.currentPlayer };
    if (state.nextPlayer) this.nextPlayer = { ...state.nextPlayer };
    if (state.timeLeft) this.timeLeft = state.timeLeft;
    if (state.isMainHost !== undefined) this.isMainHost = state.isMainHost;

    if (this.currentPlayer) {
      this.isCurrentTurnHost = this.currentPlayer.peerId === this.peerId;
    }
  }

  private handleTimeSync(data: any) {
    if (this.isCurrentTurnHost) return;

    const now = Date.now();
    this.serverTimeLeft = data.timeLeft;
    this.lastSyncTime = now;
    this.localTimeOffset = now - data.serverTime;
  }

  private handlePlayerUpdate(data: any) {
    if (data.action === 'add') {
      if (!this.players.some(p => p.id === data.player.id)) {
        this.players.push(data.player);
      }
    } else if (data.action === 'remove') {
      this.players = this.players.filter(p => p.id !== data.player.id);
    }
  }

  private sendPlayerUpdate(action: 'add' | 'remove', player: Player) {
    if (!this.conn) return;

    try {
      this.conn.send({
        type: 'playerUpdate',
        action,
        player
      });
    } catch (err) {
      console.error('Ошибка отправки обновления игрока:', err);
    }
  }

  // Вспомогательные методы
  async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert('ID скопирован!');
    } catch (err) {
      console.error('Ошибка копирования:', err);
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

  ngOnDestroy() {
    this.clearTimers();
    if (this.peer) this.peer.destroy();
    if (this.conn) this.conn.close();
  }
}