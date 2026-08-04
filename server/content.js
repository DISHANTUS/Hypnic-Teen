// Content banks for the party games.
//
// Everything ships offline so a laptop on college WiFi with no internet still
// has a full night of material. The AI Game Master (server/ai.js) tops these up
// when a key is configured — it never replaces them.

/* ------------------------------ truth or dare ----------------------------- */

export const TRUTHS = [
  "What's the most embarrassing thing you've done to impress someone?",
  'Who in this room would you trust with your phone, unlocked, for a day?',
  "What's a lie you told your parents that you still haven't confessed?",
  'Have you ever cheated in an exam? Details.',
  "What's the pettiest reason you've stopped talking to someone?",
  "What's your biggest fear that you've never told anyone here?",
  'Who was your first crush, and are they in your contacts right now?',
  "What's the worst gift you've ever received and pretended to like?",
  'How much screen time did you actually have yesterday?',
  "What's something you pretend to understand but genuinely don't?",
  'Which teacher did you secretly like the most, and why?',
  "What's the last thing you searched that you'd be embarrassed to show?",
  'Have you ever blamed someone else for something you did?',
  "What's the longest you've gone without a shower?",
  'Who here would you swap lives with for a week?',
  "What's a compliment you gave that you didn't mean at all?",
  'Have you ever pretended to be sick to skip something? What was it?',
  "What's your most useless talent?",
  "What's the worst haircut you've ever had?",
  'If your search history was projected right now, which tab would ruin you?',
];

export const DARES = [
  'Dance for 20 seconds with no music.',
  'Sing the chorus of the last song you listened to.',
  'Speak in a cartoon voice until your next turn.',
  'Call someone in your contacts and sing them happy birthday.',
  'Let the group post one word on your story.',
  'Do 15 pushups, or 30 seconds of your best air guitar.',
  'Talk in rhymes for the next two rounds.',
  'Do your best impression of someone in this room.',
  'Balance something on your head for a full minute.',
  'Text the fifth person in your recent chats "I knew it."',
  'Speak only in questions until your next turn.',
  'Do a dramatic movie-trailer voice describing this room.',
  'Let the player on your left choose your next lock screen.',
  'Act out an emotion the group picks — no words.',
  'Do the worst dance move you know, with full commitment.',
  'Say the alphabet backwards. Out loud. Right now.',
  'Compliment everyone in the room, honestly, one by one.',
  'Do a 20-second stand-up bit about your day.',
  'Hold a plank until the next player finishes their turn.',
  'Swap seats with someone and imitate them for one round.',
];

/* ------------------------------- situations ------------------------------- */

export const SITUATIONS = [
  'You become invisible for exactly one hour. What do you do?',
  'You wake up with ₹1 crore in your account. First thing you buy?',
  'You can delete one app from every phone on Earth. Which one?',
  'Your parents can read your mind for 24 hours. What is your survival plan?',
  'You can freeze time but only in the college canteen. What happens?',
  'You wake up as your best friend. What is the first thing you do?',
  'You can un-send one message you have ever sent. Which one?',
  'You are stuck in a lift for six hours with one person from this room. Who, and why?',
  'You can make one rule that everyone on campus must follow. What is it?',
  'A genie gives you unlimited food from one restaurant, forever. Which?',
  'You can time travel once, but only to a moment in your own life. When?',
  'You have to teach a class tomorrow on any topic. What are you teaching?',
  'You can swap one of your subjects for something completely made up. What is it?',
  'You get to rename your college. What is the new name?',
  'You can be famous for one thing, but you cannot choose which. What are you hoping for?',
  'Everyone can hear your thoughts for one minute a day, at a random time. How do you cope?',
  'You can automatically win any argument, but you lose the ability to lie. Deal?',
  'You find a phone with no lock and no owner. What do you actually do?',
  'You can bring one fictional character into real life. Who?',
  'You have to survive a week using only what is currently in your bag. How does it go?',
];

/* ----------------------------- find the word ------------------------------ */
// Hints go from vague to obvious; the engine reveals them one at a time.

export const WORDS = [
  { answer: 'Apple', hints: ['🍎', 'It keeps a doctor away', 'Also a company with a bitten logo'] },
  { answer: 'Cricket', hints: ['🏏', 'Eleven a side', 'India won the 1983 and 2011 World Cups in it'] },
  { answer: 'Monsoon', hints: ['🌧️', 'A season, not a month', 'Arrives in Kerala first, around June'] },
  { answer: 'Biryani', hints: ['🍚', 'Rice, but never just rice', 'Hyderabad and Lucknow argue about it'] },
  { answer: 'Wifi', hints: ['📶', 'Invisible but everyone wants it', 'You ask for its password first'] },
  { answer: 'Autorickshaw', hints: ['🛺', 'Three wheels', 'The meter is always broken'] },
  { answer: 'Chai', hints: ['☕', 'A verb in most Indian homes', 'Cutting, if you are in Mumbai'] },
  { answer: 'Exam', hints: ['📝', 'It has a hall and a ticket', 'You revise the night before it'] },
  { answer: 'Diwali', hints: ['🪔', 'Lights everywhere', 'Also called the festival of lights'] },
  { answer: 'Traffic', hints: ['🚗', 'It jams but is not fruit', 'Bengaluru is famous for it'] },
  { answer: 'Gravity', hints: ['🍏', 'Newton, allegedly', 'Keeps you on the ground'] },
  { answer: 'Password', hints: ['🔑', 'You forget it constantly', 'Should not be 123456'] },
  { answer: 'Cheetah', hints: ['🐆', 'Spots, not stripes', 'Fastest land animal'] },
  { answer: 'Volcano', hints: ['🌋', 'It sleeps and it wakes', 'Erupts with lava'] },
  { answer: 'Keyboard', hints: ['⌨️', 'It has letters but is not a book', 'QWERTY'] },
  { answer: 'Sandwich', hints: ['🥪', 'Two of one thing, many of another', 'Named after an Earl'] },
  { answer: 'Rainbow', hints: ['🌈', 'Seven of something', 'Appears after rain'] },
  { answer: 'Guitar', hints: ['🎸', 'Six strings', 'Every hostel has exactly one'] },
  { answer: 'Elephant', hints: ['🐘', 'Never forgets, they say', 'Largest land animal'] },
  { answer: 'Internet', hints: ['🌐', 'You are on it right now', 'A network of networks'] },
];

export const SCRAMBLES = [
  { answer: 'Apple', scramble: 'ELPPA' },
  { answer: 'Rocket', scramble: 'TEKCOR' },
  { answer: 'Puzzle', scramble: 'ELZZUP' },
  { answer: 'Sunset', scramble: 'TESNUS' },
  { answer: 'Guitar', scramble: 'RATIUG' },
  { answer: 'Jungle', scramble: 'ELGNUJ' },
  { answer: 'Camera', scramble: 'AREMAC' },
  { answer: 'Planet', scramble: 'TENALP' },
];

/* ---------------------------------- quiz ---------------------------------- */

export const QUIZ = {
  'General Knowledge': [
    { q: 'What is the capital of Japan?', options: ['Seoul', 'Tokyo', 'Beijing', 'Bangkok'], answer: 'Tokyo' },
    { q: 'How many continents are there?', options: ['5', '6', '7', '8'], answer: '7' },
    { q: 'Which planet is closest to the Sun?', options: ['Venus', 'Earth', 'Mercury', 'Mars'], answer: 'Mercury' },
    { q: 'What is the largest ocean?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 'Pacific' },
    { q: 'Which is the longest river in India?', options: ['Yamuna', 'Ganga', 'Godavari', 'Narmada'], answer: 'Ganga' },
    { q: 'What does WWW stand for?', options: ['World Wide Web', 'Web World Wide', 'Wide Web World', 'World Web Wide'], answer: 'World Wide Web' },
    { q: 'Which gas do plants absorb?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], answer: 'Carbon dioxide' },
    { q: 'How many players are on a football team on the field?', options: ['9', '10', '11', '12'], answer: '11' },
  ],
  Cricket: [
    { q: 'Who captained India to the 2011 World Cup win?', options: ['Virat Kohli', 'MS Dhoni', 'Sourav Ganguly', 'Rahul Dravid'], answer: 'MS Dhoni' },
    { q: 'How many balls are in a standard over?', options: ['4', '5', '6', '8'], answer: '6' },
    { q: 'Who has the most international centuries?', options: ['Ricky Ponting', 'Sachin Tendulkar', 'Virat Kohli', 'Jacques Kallis'], answer: 'Sachin Tendulkar' },
    { q: 'What does LBW stand for?', options: ['Leg Behind Wicket', 'Leg Before Wicket', 'Long Ball Wide', 'Left Bat Wicket'], answer: 'Leg Before Wicket' },
    { q: 'Which country won the first Cricket World Cup in 1975?', options: ['Australia', 'England', 'West Indies', 'India'], answer: 'West Indies' },
    { q: 'How many runs is a boundary hit along the ground worth?', options: ['2', '4', '6', '3'], answer: '4' },
  ],
  Coding: [
    { q: 'What does HTML stand for?', options: ['Hyper Trainer Markup Language', 'HyperText Markup Language', 'HyperText Machine Language', 'High Text Markup Language'], answer: 'HyperText Markup Language' },
    { q: 'Which of these is NOT a programming language?', options: ['Python', 'Java', 'Cobra', 'Photoshop'], answer: 'Photoshop' },
    { q: 'What does a "bug" mean in code?', options: ['A feature', 'An error', 'A comment', 'A variable'], answer: 'An error' },
    { q: 'Which symbol starts a comment in Python?', options: ['//', '#', '<!--', '/*'], answer: '#' },
    { q: 'What does CSS control?', options: ['Logic', 'Styling', 'Databases', 'Networking'], answer: 'Styling' },
    { q: 'In JavaScript, what does === compare?', options: ['Value only', 'Type only', 'Value and type', 'Reference only'], answer: 'Value and type' },
    { q: 'What is the time complexity of binary search?', options: ['O(n)', 'O(log n)', 'O(n²)', 'O(1)'], answer: 'O(log n)' },
  ],
  Movies: [
    { q: 'Who directed Inception?', options: ['Steven Spielberg', 'Christopher Nolan', 'James Cameron', 'Ridley Scott'], answer: 'Christopher Nolan' },
    { q: 'Which film features the quote "I am Iron Man"?', options: ['Thor', 'Iron Man', 'Avengers: Endgame', 'Both Iron Man and Endgame'], answer: 'Both Iron Man and Endgame' },
    { q: 'Which Indian film won an Oscar for Best Original Song in 2023?', options: ['Naatu Naatu (RRR)', 'Jai Ho (Slumdog)', 'Kesariya', 'Chaiyya Chaiyya'], answer: 'Naatu Naatu (RRR)' },
    { q: 'In Titanic, what is the name of the ship in the film?', options: ['Britannic', 'Olympic', 'Titanic', 'Carpathia'], answer: 'Titanic' },
    { q: 'Who played Jack Sparrow?', options: ['Orlando Bloom', 'Johnny Depp', 'Brad Pitt', 'Tom Cruise'], answer: 'Johnny Depp' },
    { q: 'Which studio makes Toy Story?', options: ['DreamWorks', 'Pixar', 'Illumination', 'Blue Sky'], answer: 'Pixar' },
  ],
  Anime: [
    { q: 'What is the name of Naruto\'s signature technique?', options: ['Chidori', 'Rasengan', 'Amaterasu', 'Kamehameha'], answer: 'Rasengan' },
    { q: 'In Death Note, what is the name of the notebook\'s owner shinigami?', options: ['Rem', 'Ryuk', 'Light', 'L'], answer: 'Ryuk' },
    { q: 'What does Luffy want to become in One Piece?', options: ['Hokage', 'King of the Pirates', 'Strongest Hunter', 'Admiral'], answer: 'King of the Pirates' },
    { q: 'In Attack on Titan, what are the walls named after?', options: ['Kings', 'Titans', 'Rivers', 'Founders'], answer: 'Kings' },
    { q: 'Which anime features a character named Goku?', options: ['Bleach', 'Dragon Ball', 'One Punch Man', 'Naruto'], answer: 'Dragon Ball' },
    { q: 'What is a "tsundere"?', options: ['A food', 'A personality archetype', 'A weapon', 'A school'], answer: 'A personality archetype' },
  ],
  College: [
    { q: 'What does CGPA stand for?', options: ['Cumulative Grade Point Average', 'College Grade Point Average', 'Central Grade Pass Average', 'Certified Grade Point Award'], answer: 'Cumulative Grade Point Average' },
    { q: 'What is the universally accepted excuse for being late?', options: ['Traffic', 'Alarm did not ring', 'Bus was cancelled', 'All of the above'], answer: 'All of the above' },
    { q: 'What is a viva?', options: ['A written exam', 'An oral exam', 'A group project', 'A holiday'], answer: 'An oral exam' },
    { q: 'What does "attendance shortage" usually lead to?', options: ['A prize', 'A detention or fine', 'Extra marks', 'Nothing'], answer: 'A detention or fine' },
    { q: 'Which is the most contested resource in any hostel?', options: ['WiFi', 'Hot water', 'Chargers', 'All of the above'], answer: 'All of the above' },
  ],
};

/* ---------------------------------- polls --------------------------------- */
// `{players}` is replaced with real names at deck-build time.

export const PLAYER_POLLS = [
  'Who is most likely to become rich?',
  'Who would survive the longest in a zombie apocalypse?',
  'Who is most likely to be late to their own wedding?',
  'Who gives the best advice?',
  'Who is most likely to become famous?',
  'Who would you call at 3AM in an emergency?',
  'Who is the biggest drama queen?',
  'Who is most likely to forget their own birthday?',
  'Who has the worst taste in music?',
  'Who is most likely to start a business?',
  'Who would win in a debate about absolutely nothing?',
  'Who is secretly the smartest here?',
  'Who is most likely to move abroad?',
  'Who takes the longest to reply to messages?',
  'Who is most likely to become a teacher?',
];

export const OPINION_POLLS = [
  { q: 'Best time to study?', options: ['Early morning', 'Afternoon', 'Late night', 'Never'] },
  { q: 'Pineapple on pizza?', options: ['Absolutely', 'Never', 'Only if hidden', 'What is pizza'] },
  { q: 'Best way to spend a free day?', options: ['Sleep', 'Go out', 'Gaming', 'Study (liar)'] },
  { q: 'Tea or coffee?', options: ['Tea', 'Coffee', 'Both', 'Neither'] },
  { q: 'Group projects are…', options: ['Great', 'Fine', 'A nightmare', 'One person doing everything'] },
  { q: 'Best phone colour?', options: ['Black', 'White', 'Something loud', 'Whatever was in stock'] },
  { q: 'Better superpower?', options: ['Flight', 'Invisibility', 'Time travel', 'Reading minds'] },
  { q: 'Ideal weekend?', options: ['Beach', 'Mountains', 'City', 'Bed'] },
];

/* ------------------------------ guess the movie --------------------------- */

export const MOVIES = [
  { answer: 'The Lion King', emoji: '👑🦁', dialogue: 'Hakuna Matata', character: 'Simba' },
  { answer: 'Spider-Man', emoji: '🕷️👨', dialogue: 'With great power comes great responsibility', character: 'Peter Parker' },
  { answer: 'The Terminator', emoji: '🤖🔫', dialogue: "I'll be back", character: 'T-800' },
  { answer: 'Iron Man', emoji: '🦾❤️', dialogue: 'I am Iron Man', character: 'Tony Stark' },
  { answer: 'Titanic', emoji: '🚢🧊💔', dialogue: "I'm the king of the world!", character: 'Jack Dawson' },
  { answer: 'Harry Potter', emoji: '⚡🧙📖', dialogue: "You're a wizard", character: 'Hermione Granger' },
  { answer: 'Frozen', emoji: '❄️👭⛄', dialogue: 'Let it go', character: 'Elsa' },
  { answer: 'Jurassic Park', emoji: '🦖🏝️', dialogue: 'Life finds a way', character: 'Dr Alan Grant' },
  { answer: 'Finding Nemo', emoji: '🐠🔍', dialogue: 'Just keep swimming', character: 'Dory' },
  { answer: 'Inception', emoji: '🌀🛌🎩', dialogue: 'You mustn\'t be afraid to dream a little bigger', character: 'Dom Cobb' },
  { answer: 'Interstellar', emoji: '🚀🌌⏳', dialogue: 'Love is the one thing that transcends time and space', character: 'Cooper' },
  { answer: '3 Idiots', emoji: '3️⃣🤪🎓', dialogue: 'All is well', character: 'Rancho' },
  { answer: 'Dangal', emoji: '🤼‍♀️🏅👨‍👧‍👧', dialogue: 'Mhari chhoriyan chhoron se kam hain ke?', character: 'Mahavir Phogat' },
  { answer: 'RRR', emoji: '🔥🐅🤝', dialogue: 'Naatu Naatu', character: 'Bheem' },
  { answer: 'Baahubali', emoji: '⚔️👑💪', dialogue: 'Why did Kattappa kill Baahubali?', character: 'Kattappa' },
  { answer: 'Sholay', emoji: '🐎🔫🤝', dialogue: 'Kitne aadmi the?', character: 'Gabbar Singh' },
  { answer: 'Avatar', emoji: '💙🌿🏹', dialogue: 'I see you', character: 'Jake Sully' },
  { answer: 'The Avengers', emoji: '🦸🦸‍♀️🌍', dialogue: 'Avengers, assemble!', character: 'Captain America' },
  { answer: 'Kung Fu Panda', emoji: '🐼🥋🍜', dialogue: 'There is no charge for awesomeness', character: 'Po' },
  { answer: 'Up', emoji: '🎈🏠👴', dialogue: 'Adventure is out there!', character: 'Carl Fredricksen' },
];

/* ------------------------------ guess the song ---------------------------- */

export const SONGS = [
  { answer: 'Why This Kolaveri Di', lyric: 'Why this kolaveri kolaveri di', emoji: '💔🥃🎸', from: 'Tamil, 2011' },
  { answer: 'Naatu Naatu', lyric: 'Polam pilla polam pilla', emoji: '🕺🔥🏅', from: 'RRR' },
  { answer: 'Jai Ho', lyric: 'Jai ho, jai ho', emoji: '🎉🙌🏆', from: 'Slumdog Millionaire' },
  { answer: 'Kesariya', lyric: 'Kesariya tera ishq hai piya', emoji: '🧡💘', from: 'Brahmastra' },
  { answer: 'Tum Hi Ho', lyric: 'Tum hi ho, ab tum hi ho', emoji: '❤️🎹😢', from: 'Aashiqui 2' },
  { answer: 'Shape of You', lyric: "I'm in love with the shape of you", emoji: '📐🫵', from: 'Ed Sheeran' },
  { answer: 'Believer', lyric: 'Pain, you made me a believer', emoji: '🥁🙏💥', from: 'Imagine Dragons' },
  { answer: 'Blinding Lights', lyric: "I said, ooh, I'm blinded by the lights", emoji: '🚗💡🌃', from: 'The Weeknd' },
  { answer: 'Despacito', lyric: 'Des-pa-cito', emoji: '🐢🇵🇷🎤', from: 'Luis Fonsi' },
  { answer: 'Perfect', lyric: 'I found a love for me, darling just dive right in', emoji: '💃✨💍', from: 'Ed Sheeran' },
  { answer: 'Channa Mereya', lyric: 'Acha chalta hoon, duaon mein yaad rakhna', emoji: '💔🚶‍♂️🔥', from: 'Ae Dil Hai Mushkil' },
  { answer: 'Senorita', lyric: 'I love it when you call me senorita', emoji: '💃🌴🔥', from: 'Shawn Mendes' },
  { answer: 'Malhari', lyric: 'Malhari, malhari', emoji: '🥁💥👑', from: 'Bajirao Mastani' },
  { answer: 'Apna Time Aayega', lyric: 'Apna time aayega', emoji: '⏰🎤🔥', from: 'Gully Boy' },
  { answer: 'Lut Gaye', lyric: 'Lut gaye, haan lut gaye', emoji: '💔🌧️😔', from: 'Emraan Hashmi' },
  { answer: 'Counting Stars', lyric: "Lately I've been losing sleep", emoji: '🌟🔢💤', from: 'OneRepublic' },
];

/* ---------------------------- imposter word pairs -------------------------- */
// The imposter gets the decoy so they can bluff — close, but not the same.

export const IMPOSTER_WORDS = [
  { word: 'Pizza', decoy: 'Burger' },
  { word: 'Cricket', decoy: 'Football' },
  { word: 'Chai', decoy: 'Coffee' },
  { word: 'Exam', decoy: 'Interview' },
  { word: 'Beach', decoy: 'Swimming pool' },
  { word: 'Cat', decoy: 'Dog' },
  { word: 'Instagram', decoy: 'WhatsApp' },
  { word: 'Train', decoy: 'Bus' },
  { word: 'Winter', decoy: 'Monsoon' },
  { word: 'Guitar', decoy: 'Piano' },
  { word: 'Doctor', decoy: 'Nurse' },
  { word: 'Biryani', decoy: 'Fried rice' },
  { word: 'Mountain', decoy: 'Desert' },
  { word: 'Netflix', decoy: 'YouTube' },
  { word: 'Wedding', decoy: 'Birthday party' },
  { word: 'Library', decoy: 'Classroom' },
  { word: 'Sunrise', decoy: 'Sunset' },
  { word: 'Rain', decoy: 'Snow' },
];

export const IMPOSTER_QUESTIONS = [
  'Describe it in one word.',
  'What does it remind you of?',
  'How would you explain it to a five-year-old?',
  'Rate it out of 10 and say why.',
  'What sound or smell goes with it?',
  'Where would you find it?',
];
