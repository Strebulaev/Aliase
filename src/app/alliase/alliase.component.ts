import { Component, OnInit, OnDestroy } from '@angular/core';
import { Peer, DataConnection } from 'peerjs';
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
  templateUrl: './alliase.component.html',
  styleUrls: ['./alliase.component.css']
})
export class AlliaseComponent implements OnInit, OnDestroy {
  // Game state
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

  // Game settings
  gameSettings: GameSettings = {
    roundTime: 60,
    totalRounds: 3,
    maxWordLength: 2,
    teamsCount: 2
  };

  // Players
  players: Player[] = [];
  newPlayerName = '';
  currentPlayer: Player | null = null;
  nextPlayer: Player | null = null;

  // PeerJS connection
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  peerId = '';
  friendPeerId = '';
  connectionStatus = 'Инициализация...';
  showConnectionPanel = true;
  showPlayerForm = false;

  // Game timers
  private gameTimer: any;
  timeLeft = 0;
  private allWords: string[] = [];
  private wordBank: string[] = [...unusedWords];

  async ngOnInit() {
    await this.initPeerConnection();
  }

  ngOnDestroy() {
    this.cleanup();
  }

  private cleanup() {
    if (this.peer) {
      this.peer.destroy();
    }
    if (this.conn) {
      this.conn.close();
    }
    clearInterval(this.gameTimer);
  }

  private async initPeerConnection() {
    try {
      this.peer = new Peer({
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.connectionStatus = 'Готов к подключению';
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        this.connectionStatus = 'Ошибка подключения';
      });

    } catch (err) {
      console.error('Peer initialization error:', err);
      this.connectionStatus = 'Ошибка инициализации';
    }
  }

  private handleIncomingConnection(conn: DataConnection) {
    this.conn = conn;
    this.isMainHost = true;
    this.connectionStatus = `Подключен игрок: ${conn.peer}`;
    this.isConnected = true;
    this.showConnectionPanel = false;

    conn.on('data', (data: any) => {
      this.handleReceivedData(data);
    });

    conn.on('close', () => {
      this.connectionStatus = 'Соединение закрыто';
      this.isConnected = false;
    });

    // Send initial game state to the new player
    this.syncGameState();
  }

  connectToFriend() {
    if (!this.friendPeerId || !this.peer) {
      alert('Введите ID друга и дождитесь инициализации');
      return;
    }

    this.connectionStatus = 'Подключаемся...';
    this.conn = this.peer.connect(this.friendPeerId);

    this.conn.on('open', () => {
      this.connectionStatus = 'Успешное подключение!';
      this.isConnected = true;
      this.showConnectionPanel = false;
    });

    this.conn.on('data', (data: any) => {
      this.handleReceivedData(data);
    });

    this.conn.on('error', (err) => {
      console.error('Connection error:', err);
      this.connectionStatus = 'Ошибка подключения';
    });
  }

  private handleReceivedData(data: any) {
    if (data.type === 'game-state') {
      this.gameState = data.state;
      this.players = data.players;
      this.gameSettings = data.settings;
    }
  }

  private syncGameState() {
    if (!this.conn) return;

    this.conn.send({
      type: 'game-state',
      state: this.gameState,
      players: this.players,
      settings: this.gameSettings
    });
  }

  // Остальные методы игры остаются без изменений
  addPlayer() {
    if (!this.newPlayerName.trim()) return;

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

    this.syncGameState();
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
      currentWord: this.getNextWord(),
      scores: new Array(this.gameSettings.teamsCount).fill(0),
      usedWords: [],
      isGameStarted: true,
      isGameFinished: false,
      isBetweenRounds: false
    };

    this.startPlayerTurn();
    this.syncGameState();
  }

  private prepareWords() {
    this.allWords = [...this.wordBank]
      .filter(word => word.split(' ').length <= this.gameSettings.maxWordLength)
      .sort(() => Math.random() - 0.5);
  }

  private getNextWord(): string {
    return this.allWords.pop() || 'Слово не найдено';
  }

  private startPlayerTurn() {
    this.currentPlayer = this.players[this.gameState.currentPlayerIndex];
    this.isCurrentTurnHost = this.currentPlayer.peerId === this.peerId;
    this.timeLeft = this.gameSettings.roundTime;

    this.gameTimer = setInterval(() => {
      this.timeLeft--;
      
      if (this.timeLeft <= 0) {
        this.endPlayerTurn();
      }
    }, 1000);
  }

  endPlayerTurn() {
    clearInterval(this.gameTimer);
    this.gameState.isBetweenRounds = true;
    this.syncGameState();
  }

  continueGame() {
    this.gameState.currentPlayerIndex++;
    
    if (this.gameState.currentPlayerIndex >= this.players.length) {
      this.gameState.currentPlayerIndex = 0;
      this.gameState.currentRound++;
      
      if (this.gameState.currentRound > this.gameSettings.totalRounds) {
        this.endGame();
        return;
      }
    }

    this.gameState.isBetweenRounds = false;
    this.startPlayerTurn();
    this.syncGameState();
  }

  endGame() {
    this.gameState.isGameFinished = true;
    this.syncGameState();
  }

  handleAnswer(isCorrect: boolean) {
    if (!this.currentPlayer) return;

    this.gameState.usedWords.push({
      word: this.gameState.currentWord,
      guessed: isCorrect,
      team: this.currentPlayer.team
    });

    if (isCorrect) {
      this.gameState.scores[this.currentPlayer.team]++;
    }

    this.gameState.currentWord = this.getNextWord();
    this.syncGameState();
  }

  canContinueGame(): boolean {
    if (!this.nextPlayer) return false;
    return this.nextPlayer.peerId === this.peerId || this.isMainHost;
  }

  restartGame() {
    this.gameState.isGameFinished = false;
    this.startGame();
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      alert('ID скопирован!');
    });
  }
}