var majorWidth = 2;
var minorWidth = 0.25;

function getWidth(n) {
    return n % 2 == 0 ? minorWidth : majorWidth;
}
function getOffset(idx) {
    return idx/2 * (majorWidth + minorWidth);
}

function generateMaze(size) {
    return [
        [
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [false,false,false,false,true],
            [true, true, true, false,true],
            [true, false,false,false,true],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [true, true, true, false,true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [true, false,false,false,true],
            [true, false,true, true, true],
            [true, false,false,false,false],
            [true, true, true, true, true]
        ],
        [
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true],
            [true, true, true, true, true]
        ]
    ]
}