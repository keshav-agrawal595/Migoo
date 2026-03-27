const url1 = "http://localhost:3001/public/avatars/avatar1-intro.mp4";
const match1 = url1.match(/avatars\/avatar[0-9]+-(intro|outro)\.mp4/);
console.log("Match1:", match1 ? match1[0] : null);

const url2 = "http://localhost:3001/public/avatars/avatar1-intro.mp4";
console.log("Includes:", url2.includes('avatars/avatar'));
