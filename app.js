const express = require('express');
const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static("public"));

app.get('/', (req, res) => {
  res.render("dashboard/index");
});

app.get("/analyze" , (req , res) => {
   res.render("repository/analyze");
});

app.listen(port, () => {
  console.log(` listening on port ${port}`)
});
