var majorWidth = 2;
var minorWidth = 0.25;

var axes = ['x', 'y', 'z'];

function getWidth(n) {
    return n % 2 == 0 ? minorWidth : majorWidth;
}
function getOffset(idx) {
    return idx/2 * (majorWidth + minorWidth);
}
function inBounds(x,y,z, size) {
    var ir = (a) => a >= 0 && a < 2*size + 1;
    return ir(x) && ir(y) && ir(z);
}

function generateMaze(size) {
    var segments = size * 2 + 1
    function coord2num(x, y, z) {
        return x + segments*y + segments*segments*z;
    }
    function num2coord(n) {
        return {x: n % segments, y: Math.floor(n/segments) % segments, z: Math.floor(n/(segments*segments))}
    }
    var fullCells = [];
    function removeCell(cellNum) {
        var idx = fullCells.indexOf(cellNum);
        if (idx != -1)
            fullCells.splice(idx,1);
        else
            throw Error("Trying to remove cell not in list");
    }
    function randomCellNum() {
        return fullCells[Math.floor(Math.random() * fullCells.length)];
    }

    var board = Array(segments);
    for (var i = 0; i < segments; i++) {
        board[i] = Array(segments);
        for (var j = 0; j < segments; j++) {
            board[i][j] = Array(segments).fill(0);

            if (i%2 == 1 && j%2 == 1) {
                for (var k = 1; k < segments; k+=2) {
                    fullCells.push(coord2num(i,j,k));
                }
            }
        }
    }

    /*
        Wilson maze generation
        0: filled cell (block starts full and gets hollowed out)
        1: empty cell
        directions:
        2: x-
        3: y-
        4: z-
        5: x+
        6: y+
        7: z+
    */
    function num2dir(num) {
        var out = {x: 0, y: 0, z: 0};
        num -= 2;
        out[ axes[num % 3] ] = (num >= 3 ? 1 : -1);
        return out;
    }
    function emptyCell(num) {
        var c = num2coord(num);
        board[c.x][c.y][c.z] = 1;
        removeCell(num);
    }
    // empty one cell to start
    emptyCell(randomCellNum());

    // run until every cell in the maze is used
    while (fullCells.length > 0) {
        // pick a random unused cell
        var startNum = randomCellNum();
        var start = num2coord(startNum);
        var curr = {x: start.x, y: start.y, z: start.z};

        // move around until you find an empty cell
        while (board[curr.x][curr.y][curr.z] != 1) {
            // pick random direction
            var dirNum = Math.floor(Math.random() * 6 + 2);
            var dir = num2dir(dirNum);
            // make sure the direction wouldn't move us out of bounds
            while (!inBounds(curr.x + dir.x*2, curr.y + dir.y*2, curr.z + dir.z*2, size)) {
                dirNum = Math.floor(Math.random() * 6 + 2);
                dir = num2dir(dirNum);
            }
            // record the direction and advance
            board[curr.x][curr.y][curr.z] = dirNum;
            axes.forEach(a => curr[a] += dir[a]*2);
        }
        // retrace path, opening up walls as well as main cells
        curr = {x: start.x, y: start.y, z: start.z};
        while (board[curr.x][curr.y][curr.z] != 1) {
            var dirNum = board[curr.x][curr.y][curr.z];
            var dir = num2dir(dirNum);

            // empty the current cell
            emptyCell(coord2num(curr.x, curr.y, curr.z));

            // empty the wall between the cells (not part of full cell list)
            board[curr.x+dir.x][curr.y+dir.y][curr.z+dir.z] = 1;

            // advance
            axes.forEach(a => curr[a] += dir[a]*2);
        }
    }

    // convert to boolean and return
    var output = Array(segments);
    for (var i = 0; i < segments; i++) {
        output[i] = Array(segments);
        for (var j = 0; j < segments; j++) {
            output[i][j] = board[i][j].map((n) => n == 0);
        }
    }
    // open start and end
    output[1][1][0] = false;
    output[segments - 2][segments - 2][segments - 1] = false;
    return output;
}